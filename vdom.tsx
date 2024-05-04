// virtual dom ////////////

interface VDomNode {
  tag: HTMLElement["tagName"];
  attributes?: Record<string, any>;
  children?: (VDomNode | undefined)[];
  state: IState & { names?: Record<string, HTMLElement> };
  effects?: EffectHolder<any[], any[]>[];
  nthEffect: number;
}

const ifNotNode: Node = document.createComment("!iff");
const nullNode: Node = document.createComment("null");

function vdomToRealDomRecurse(vtree: VDomNode | null | undefined, parentElement: Node): Node {
  if (primitiveTypes.includes(typeof vtree)) return parentElement.appendChild(document.createTextNode(vtree as any));
  if (!vtree || !vtree.tag) return parentElement.appendChild(nullNode);
  const elName = vtree.attributes?.name as string;
  if (vtree.attributes && !vtree.attributes.iff && Object.hasOwn(vtree.attributes, "iff")) return parentElement.appendChild(ifNotNode);
  if (elName) {
    if (!vtree.state.names) vtree.state.names = {};
    if (!vtree.state.names[elName]) vtree.state.names[elName] = document.createElement(vtree.tag);
  }
  const el = elName ? vtree.state.names![elName] : document.createElement(vtree.tag);
  parentElement.appendChild(el);
  for (const attributeName in vtree.attributes) {
    const attributeValue = vtree.attributes[attributeName];
    if (attributeName.startsWith("on")) {
      const eventName = attributeName.slice(2).toLowerCase();
      el.addEventListener(eventName, attributeValue);
      el.addEventListener(eventName, scheduleRerender);
    } else {
      switch (attributeName) {
        case "innerText":
        case "textContent":
          el.innerText = attributeValue;
          break;
        case "if":
          if (!attributeValue) el.setAttribute("style", "display:none!important");
          break;
        case "iff":
          break;
        case "style":
          const s =
            typeof attributeValue === "object"
              ? Object.keys(attributeValue)
                  .map(key => `${key}:${attributeValue[key]}`)
                  .join(";")
              : attributeValue;
          el.setAttribute("style", s);
          break;
        case "value":
          el.setAttribute(attributeName, attributeValue); // attribute because property would erase user's current value
          break;
        default:
          el.setAttribute(attributeName, attributeValue);
          break;
      }
    }
  }
  if (vtree.children?.length) for (const child of vtree.children) vdomToRealDomRecurse(child, el);
  return el;
}

function vdomToRealDom(vtree: VDomNode): void {
  appRootElement.replaceChildren(vdomToRealDomRecurse(vtree, document.createElement("div")));
  afterRendering();
}

// useEffect ////////////

type OnEffectHandler<T, R = any> = (args: T, state: IState, rerenderFn: () => void) => R;

interface EffectHolder<T, R = any> {
  effectType: "diff" | "elRef";
  oldArgs: T;
  newArgs: T;
  callback: OnEffectHandler<T, R>;
  then: (what: OnEffectHandler<T, R>) => any;
}

const effectsToRun = new Set<VDomNode>();

function newEmptyEffect(effectType: EffectHolder<any, any>["effectType"]): EffectHolder<any[], any> {
  const effect = { effectType, oldArgs: [NaN], callback: doNothing } as any;
  effect.then = (what: OnEffectHandler<any[]>) => (effect.callback = what);
  return effect;
}

function onSomething(effectType: EffectHolder<any, any>["effectType"], ...newArgs: any[]): EffectHolder<typeof newArgs, any> {
  if (!currentVDomNode.effects) currentVDomNode.effects = [];
  const i = ++currentVDomNode.nthEffect;
  if (!currentVDomNode.effects[i]) currentVDomNode.effects[i] = newEmptyEffect(effectType);
  currentVDomNode.effects[i].newArgs = newArgs;
  effectsToRun.add(currentVDomNode);
  return currentVDomNode.effects[i];
}

const onDiff = (...newArgs: any[]): EffectHolder<typeof newArgs> => onSomething("diff", ...newArgs);
const onReady = (...newArgs: any[]): EffectHolder<typeof newArgs> => onSomething("elRef", ...newArgs);

function afterRendering() {
  for (const vdom of effectsToRun) {
    if (vdom.effects)
      for (const effect of vdom.effects) {
        const somethingChanged = effect.oldArgs.length != effect.newArgs.length || effect.oldArgs.some((arg, i) => !Object.is(arg, effect.newArgs[i]));
        const old = effect.oldArgs;
        effect.oldArgs = effect.newArgs;
        if (somethingChanged) {
          console.log("diff", vdom.tag, old, effect.newArgs);
          switch (effect.effectType) {
            case "diff":
              const retval = (effect.callback as OnEffectHandler<typeof effect.newArgs>)(effect.newArgs, vdom.state, scheduleRerender);
              if (retval instanceof Promise) {
                console.log("ASYNC");
                //scheduleRerender();
                retval.finally(scheduleRerender);
              }
              // retval instanceof Promise ? retval.finally(scheduleRerender) : scheduleRerender(); // TODO this might be right
              break;
            case "elRef":
              (effect.callback as OnEffectHandler<typeof effect.newArgs>)(effect.newArgs, vdom.state, scheduleRerender);
              break;
          }
        }
      }
  }
  effectsToRun.clear();
}

// closure components ////////////

const head = Symbol("head");
const tail = Symbol("tail");
const rendered = Symbol("rendered");

type IState = Record<string | number | symbol, any> & { names?: Record<string, HTMLElement>; [tail]?: ShallowVDomNode[] };

type Primitives = boolean | undefined | null | string | number | bigint;

interface ComponentDefinition<S extends IState = IState> {
  (propsAndStateAndChildren: S | { [tail]: any[] }): ShallowVDomNode<S> | Primitives | Promise<ShallowVDomNode<S> | Primitives>;
  testid?: string;
}

declare interface Promise<T> {
  handled?: boolean;
}

interface ShallowVDomNode<S extends IState = IState> {
  [head]: HTMLElement["tagName"] | ComponentDefinition<S> | undefined | null | "";
  [tail]?: ShallowVDomNode[];
  [key: string | number | symbol]: any;
}

const primitiveTypes = ["bigint", "string", "symbol", "boolean", "number", "undefined", "null", "array"];

let currentVDomNode: VDomNode;

function newEmptyVDom(aFunctionAndItsInputs: ShallowVDomNode): VDomNode {
  return { tag: "", attributes: {}, state: aFunctionAndItsInputs, nthEffect: -1 };
}

function componentToVDom(aFunctionAndItsInputs: ShallowVDomNode, vnode?: VDomNode): VDomNode | undefined {
  vnode ||= newEmptyVDom(aFunctionAndItsInputs);
  vnode.nthEffect = -1;
  currentVDomNode = vnode;
  let outputFromAFunction = typeof aFunctionAndItsInputs[head] == "function" ? aFunctionAndItsInputs[head](aFunctionAndItsInputs) : aFunctionAndItsInputs;
  // console.log({ shallowdom });
  if (outputFromAFunction instanceof Promise) {
    if (vnode.state[rendered]) outputFromAFunction = vnode.state[rendered] as ShallowVDomNode;
    else if (!outputFromAFunction.handled) {
      // console.log("!handled");
      outputFromAFunction.handled = true;
      outputFromAFunction.then(render => {
        // console.log("setting state[rendered]");
        vnode!.state[rendered] = render;
        scheduleRerender();
        return render;
      });
      return vnode;
    } else return vnode;
    // console.log("continuing with ", { shallowdom });
  }
  if (typeof outputFromAFunction === "string") return outputFromAFunction as any;
  if (typeof outputFromAFunction === "boolean") return outputFromAFunction as any;
  if (typeof outputFromAFunction === "number") return outputFromAFunction as any;
  if (typeof outputFromAFunction === "bigint") return outputFromAFunction as any;
  if (typeof outputFromAFunction === "symbol") return outputFromAFunction as any;
  if (typeof outputFromAFunction === "undefined") return outputFromAFunction as any;
  if (outputFromAFunction == null) return outputFromAFunction as any;
  if (Array.isArray(outputFromAFunction)) return outputFromAFunction as any;

  //// from here, we have the return value of a component which is exactly one node-template with 0+ children  /////
  // interface VDomNode {
  //   tag: HTMLElement["tagName"];
  //   attributes?: Record<string, any>;
  //   children?: (VDomNode | undefined)[];
  //   state: IState;
  //   effects?: DiffEffectHolder<any[], any[]>[] | RefEffectHolder<any[], any[]>[];
  //   nthEffect: number;
  //   state.names?: Record<string, HTMLElement>;
  // }

  // tagname if that one node-template ISN'T a component
  if (typeof outputFromAFunction[head] === "string") vnode.tag = outputFromAFunction[head];

  // all attributes of that one node-template
  vnode.attributes = outputFromAFunction;

  // one auto-generated attribute if that one node-template IS a component
  if (typeof aFunctionAndItsInputs[head] == "function") {
    if (!aFunctionAndItsInputs[head].testid) {
      const fnDef: string = aFunctionAndItsInputs[head].toString();
      aFunctionAndItsInputs[head].testid = fnDef.startsWith("function ") ? fnDef.slice(9, fnDef.indexOf("(")) : "anonymous component";
    }
    vnode.attributes["data-testid"] = aFunctionAndItsInputs[head].testid;
  }

  // recurse through children if any
  vnode.children = (outputFromAFunction[tail] || []).map((child, i) =>
    primitiveTypes.includes(typeof child) ? (child as any) : componentToVDom(child, vnode!.children?.[i])
  );

  return typeof outputFromAFunction[head] === "string" ? vnode : componentToVDom(outputFromAFunction, vnode);
}

let freshVDom: VDomNode | undefined = undefined;
let topAppComponent: ShallowVDomNode | undefined = undefined;
let appRootElement: HTMLElement = document.body;
let scheduledRerenders = 0;

function start(app: ShallowVDomNode, rootElement?: HTMLElement | null) {
  topAppComponent = app;
  if (rootElement) appRootElement = rootElement;
  else {
    appRootElement = document.createElement("div");
    document.body.insertBefore(appRootElement, document.body.firstChild);
  }
  rerender();
}

function scheduleRerender(): void {
  scheduledRerenders++;
  Promise.resolve().then(() => !--scheduledRerenders && rerender());
}

function rerender() {
  if (scheduledRerenders) return; // a later promise is already in the queue
  freshVDom = componentToVDom(topAppComponent!, freshVDom);
  if (scheduledRerenders) return; // if above line called scheduleRerender(), don't commit to real dom
  vdomToRealDom(freshVDom!);
}

// jsx stand-in ////////////

type EachValuePartial<Type> = {
  [Property in keyof Type]: Partial<Type[Property] | { style?: string }>;
};

declare namespace JSX {
  type IntrinsicElements = EachValuePartial<HTMLElementTagNameMap>;
}

function jsx(tag: ShallowVDomNode[typeof head], propsOrAttributes: IState, ...rest: ShallowVDomNode[]): ShallowVDomNode {
  const retval: ShallowVDomNode = { [head]: tag, [tail]: rest, ...propsOrAttributes };
  // console.log(JSON.stringify(retval));
  return retval;
}

// utility ////////////

const doNothing = () => void 0;

const wait = (milliseconds = 0) => new Promise(r => setTimeout(r, milliseconds));

function cloneAndStamp(svNode: ShallowVDomNode, value: any): ShallowVDomNode {
  const retval = { ...svNode };
  retval.if = true;
  retval.name = value;
  return retval;
}

// sample components ////////////

function For(state: IState & { each?: any[] }): ShallowVDomNode | undefined {
  //console.log("<For />", props, state, children);
  const children = state[tail] || [];
  const values = state.each || [];
  if (!children.length || !values.length) return undefined;
  const stampedOut = values.flatMap(value => children.map(child => cloneAndStamp(child, value)));
  return { [head]: "for-each", [tail]: stampedOut, class: "lkj" };
}

function Writer(): ShallowVDomNode {
  //console.log("Writer invoked");
  const message = "hello world ";

  onReady().then((args, state, rerenderFn) => {
    const elements = state.names;
    console.log("REF ELEMENTS", { elements, args, state });
    elements?.rememberme.focus();
    //state.elements = elements;
  });

  // onDiff(state.local).then(args => {
  //   console.log("ondiff local", args);
  //   console.log("ondiff state el", state.elements?.rememberme.value);
  // });

  // const handler = e => {
  //   // state.local = e.target.value;
  //   // console.log("From event,", state.local);
  // };

  // TODO onKeyDown handler breaks it all. prop not attribute...
  return <input name="rememberme" value={message} />;
  //  return { [head]: "input", value: message, name: "rememberme" };
}

function MainMenu(): ShallowVDomNode {
  return {
    [head]: "menu",
    [tail]: [
      { [head]: "div", textContent: "item 1 if:false", if: false },
      { [head]: "div", textContent: "item 2 if:true", if: true },
      { [head]: "div", [tail]: [{ [head]: Writer }] },
      { [head]: "div", textContent: "item 4 if:50%", if: Math.random() < 0.5 },
      { [head]: "div", textContent: "item 5 iff:50%", iff: Math.random() < 0.5 },
      { [head]: "div", textContent: "item 6 iff:false", iff: false },
      { [head]: "div", textContent: "item 7 iff:true", iff: true },
      { [head]: For, each: [0, 1], [tail]: [{ [head]: "div", "data-testid": "looped", class: "looper", textContent: "Item X" }] },
    ],
  };
}

function MainContent(state: IState & { buttonLabel: string }): ShallowVDomNode {
  const onClick = () => {
    state.counter = (state.counter || 0) + 1;
    alert("counter at " + state.counter);
    if (!(state.counter % 3)) state.triple = state.triple ? state.triple + 1 : 1;
  };

  onDiff(state.triple).then(async ([triple], state) => {
    await Promise.resolve(0);
    console.log("USEEFFECT 3rd", triple, "counter=", state.counter);
  });

  // return (
  //   <div className="mx-b" id="contentroot">
  //     <span style={{ fontWeight: "bold" }}>{"in a span " + (state.counter || 0) + " triple " + state.triple}</span>
  //     <button type="button" onclick={onClick}>
  //       {buttonLabel}
  //     </button>
  //   </div>
  // );

  return {
    [head]: "main",
    class: "mx-b",
    id: "contentroot",
    [tail]: [
      { [head]: "span", style: "font-weight:bold", textContent: "in a span " + (state.counter || 0) + " triple " + state.triple },
      { [head]: "button", type: "button", textContent: state.buttonLabel, onClick },
    ],
  };
}

async function Eventually(): Promise<ShallowVDomNode> {
  console.log("Eventually");
  await wait(3000);
  console.log("Timeup");
  return <h2>Here!</h2>;
}

function OldEventually(mostlyItsInputs: IState): ShallowVDomNode {
  onDiff().then(async () => {
    console.log("FETCHING...");
    mostlyItsInputs.result = <div>fetching...</div>;
    await wait(3000);
    console.log("FETCHED");
    mostlyItsInputs.result = <h2>Here!</h2>;
  });

  console.log("state.result=", mostlyItsInputs.result);
  return mostlyItsInputs.result;
}

function Layout({ buttonLabel, style }: { buttonLabel: string; style: string }): ShallowVDomNode {
  return (
    <div style={style}>
      {/*<OldEventually />*/}
      <MainMenu />
      <MainContent buttonLabel={buttonLabel} />
    </div>
  );
}

////

start(<Layout buttonLabel="Push me" style="background-color: blue" />, document.getElementById("vdom"));
