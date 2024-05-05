// virtual dom ////////////

interface VDomNode {
  tag: HTMLElement["tagName"];
  attributes?: Record<string, any>;
  children?: VDomNodeOrPrimitive[];
  state: IState & { names?: Record<string, HTMLElement> };
  effects?: EffectHolder<any[], any[]>[];
  nthEffect: number;
}

type VDomNodeOrPrimitive = VDomNode | Primitives;

const ifNotNode: Readonly<Node> = document.createComment("!iff");
const nullNode: Readonly<Node> = document.createComment("null");

function vdomToRealDomRecurse(vtree: VDomNodeOrPrimitive, parentElement: Node): Node {
  // if (Array.isArray( vtree  )) return parentElement.appendChild(document.createTextNode(vtree as any));
  if (typeof vtree !== "object") return parentElement.appendChild(document.createTextNode(vtree as any));
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
        case "names":
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

function vdomToRealDom(vtree: VDomNodeOrPrimitive): void {
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

type IState = Record<string | number | symbol, any> & { names?: Record<string, HTMLElement>; [tail]?: TemplateNoState[] };

type Primitives = boolean | undefined | null | string | number | bigint;
const primitiveTypes: Readonly<Primitives[]> = ["bigint", "string", "symbol", "boolean", "number", "undefined", "array"];

interface ComponentDefinition<S extends IState = IState> {
  (propsAndStateAndChildren: S): TemplateNoState<S> | Primitives | Promise<TemplateNoState<S> | Primitives>;
  testid?: string;
}

type CC = ComponentDefinition;

declare interface Promise<T> {
  handled?: boolean;
}

interface TemplateNoState<S extends IState = IState> {
  [head]: HTMLElement["tagName"] | ComponentDefinition<S> | undefined | null | "";
  [tail]?: TemplateNoState[];
  [key: string | number | symbol]: any;
}

function componentToVDom(aFunctionAndItsInputs: TemplateNoState, vnode?: VDomNodeOrPrimitive): VDomNodeOrPrimitive {
  if (typeof aFunctionAndItsInputs !== "object") return aFunctionAndItsInputs;
  if (typeof vnode !== "object" && vnode != undefined) return vnode;
  vnode ||= { tag: "", attributes: {}, state: aFunctionAndItsInputs, nthEffect: -1 };
  vnode.nthEffect = -1;
  currentVDomNode = vnode;
  let outputFromAFunction =
    typeof aFunctionAndItsInputs[head] == "function" ? aFunctionAndItsInputs[head].call(vnode.state, aFunctionAndItsInputs) : aFunctionAndItsInputs;
  // console.log({ shallowdom });

  if (typeof outputFromAFunction !== "object") return outputFromAFunction;
  if (!outputFromAFunction) return outputFromAFunction;
  //if (Array.isArray(outputFromAFunction)) return outputFromAFunction;
  const vnodeInClosure = vnode; // don't put parameter in closure
  if (outputFromAFunction instanceof Promise) {
    if (!vnode.state[rendered]) {
      if (!outputFromAFunction.handled) {
        outputFromAFunction.then(render => {
          vnodeInClosure.state[rendered] = render;
          scheduleRerender();
          return render;
        });
        outputFromAFunction.handled = true;
      }
      return vnode;
    }
    outputFromAFunction = vnode.state[rendered] as TemplateNoState;
  }

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
    if (typeof aFunctionAndItsInputs[head].testid != "string") {
      const fnDef: string = aFunctionAndItsInputs[head].toString();
      aFunctionAndItsInputs[head].testid = fnDef.startsWith("function ") ? fnDef.slice(9, fnDef.indexOf("(")) : "";
    }
    if (aFunctionAndItsInputs[head].testid) vnode.attributes["data-testid"] = aFunctionAndItsInputs[head].testid;
  }

  // recurse through children if any
  vnode.children = (outputFromAFunction[tail] || []).map((child, i) => componentToVDom(child, vnodeInClosure.children?.[i]));

  return typeof outputFromAFunction[head] === "string" ? vnode : componentToVDom(outputFromAFunction, vnode);
}

const effectsToRun = new Set<VDomNode>();
let currentVDomNode: VDomNode;
let freshVDom: VDomNodeOrPrimitive = undefined;
let topAppComponent: TemplateNoState | undefined = undefined;
let appRootElement: HTMLElement = document.body;
let scheduledRerenders = 0;
let globalState: Record<string | number | symbol, any> = { styles: {} };

function start(app: TemplateNoState, rootElement?: HTMLElement | null) {
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

function jsx(tag: TemplateNoState[typeof head], propsOrAttributes: IState, ...rest: TemplateNoState[]): TemplateNoState {
  const retval: TemplateNoState = { [head]: tag, [tail]: rest, ...propsOrAttributes };
  // console.log(JSON.stringify(retval));
  return retval;
}

// utility ////////////

const doNothing = () => void 0;

const wait = (milliseconds = 0) => new Promise(r => setTimeout(r, milliseconds));

// css ///////////

function css(name: string, props: string) {
  if (globalState.styles[name]) return name;
  const el = document.createElement("style");
  el.id = name;
  el.innerText = `.${name}{${props}}`;
  document.head.appendChild(el);
  globalState.styles[name] = el;
  return name;
}

// function onCssRule(name: string, props: string): string {
//   onDiff().then(() => css(name, props));
//   return name;
// }

// sample components ////////////

const outsideCss = css("outsideCss", "display:block");

const FlexRow: CC = ({ [tail]: children }: IState) => {
  const flexRowCss = css("flexRow", "display:flex");
  return { [head]: "flex-row", class: flexRowCss, [tail]: children };
};

const For: CC = ({ each, [tail]: children }: IState & { each?: any[] }) =>
  children && each && children.length && each.length
    ? {
        [head]: "for-each",
        [tail]: each.flatMap(value =>
          children.map(child => {
            const retval = { ...child };
            retval.if = true;
            retval.name = value;
            return retval;
          })
        ),
      }
    : undefined;

function Writer(): TemplateNoState {
  //console.log("Writer invoked");
  const message = "hello world ";

  onReady().then((args, state, rerenderFn) => {
    console.log("REF ELEMENTS", { args, state });
    state.names?.rememberme.focus();
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

function MainMenu(): TemplateNoState {
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

function MainContent(this: { counter?: number; triple?: number }, { buttonLabel }: { buttonLabel: string }): TemplateNoState {
  console.log("maincontent this, state", { buttonLabel, this: this });
  const onClick = () => {
    this.counter = (this.counter || 0) + 1;
    alert("counter at " + this.counter);
    if (!(this.counter % 3)) this.triple = this.triple ? this.triple + 1 : 1;
  };

  onDiff(this.triple).then(async ([triple], state) => {
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
      { [head]: "span", style: "font-weight:bold", textContent: "in a span " + (this.counter || 0) + " triple " + this.triple },
      { [head]: "button", type: "button", textContent: buttonLabel, onClick },
    ],
  };
}

async function Eventually(): Promise<TemplateNoState> {
  console.log("Eventually");
  await wait(3000);
  console.log("Timeup");
  return <h2>Here!</h2>;
}

function OldEventually(mostlyItsInputs: IState): TemplateNoState {
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

function TopMenu() {
  return {
    [head]: FlexRow,
    [tail]: [
      { [head]: "div", [tail]: ["One"] },
      { [head]: "div", [tail]: ["Two"] },
      { [head]: "div", [tail]: ["Three"] },
    ],
  };
}

function Footer() {
  return {
    [head]: FlexRow,
    [tail]: [
      { [head]: "div", innerText: "Four" },
      { [head]: "div", [tail]: ["Five"] },
      { [head]: "div", textContent: "Six" },
    ],
  };
}

function Layout({ buttonLabel, style }: { buttonLabel: string; style: string }): TemplateNoState {
  return (
    <div style={style}>
      {/*<OldEventually />*/}
      <TopMenu />
      <MainMenu />
      <MainContent buttonLabel={buttonLabel} />
      <Footer />
    </div>
  );
}

////

start(<Layout buttonLabel="Push me" style="background-color: blue" />, document.getElementById("vdom"));
