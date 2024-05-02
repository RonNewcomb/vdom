// virtual dom ////////////

interface VDomNode {
  tag: HTMLElement["tagName"];
  attributes?: Record<string, any>;
  children?: (VDomNode | undefined)[];
  state: IState;
  effects?: DiffEffectHolder<any[], any[]>[] | RefEffectHolder<any[], any[]>[];
  nthEffect: number;
  statefulElements?: Record<string, HTMLElement>;
}

const ifNotNode: Node = document.createComment("!iff");
const nullNode: Node = document.createComment("null");

function vdomToRealDomRecurse(vtree: VDomNode | null | undefined, parentElement: Node): Node {
  if (primitiveTypes.includes(typeof vtree)) return parentElement.appendChild(document.createTextNode(vtree as any));
  if (!vtree || !vtree.tag) return parentElement.appendChild(nullNode);
  const elName = vtree.attributes?.name as string;
  if (vtree.attributes && !vtree.attributes.iff && Object.hasOwn(vtree.attributes, "iff")) return parentElement.appendChild(ifNotNode);
  if (elName) {
    if (!vtree.statefulElements) vtree.statefulElements = {};
    if (!vtree.statefulElements[elName]) vtree.statefulElements[elName] = document.createElement(vtree.tag);
  }
  const el = elName ? vtree.statefulElements![elName] : document.createElement(vtree.tag);
  parentElement.appendChild(el);
  for (const attributeName in vtree.attributes) {
    const attributeValue = vtree.attributes[attributeName];
    if (attributeName.startsWith("on")) {
      const eventName = attributeName.slice(2).toLowerCase();
      el.addEventListener(eventName, attributeValue);
      el.addEventListener(eventName, scheduleRerender);
    } else {
      switch (attributeName) {
        case "textContent":
          el.append(attributeValue);
          break;
        case "if":
          if (!attributeValue) el.setAttribute("style", "display:none!important");
          break;
        case "iff":
        case "props":
          break;
        case "tag":
        case "tagName":
          //case head:
          break;
        case "children":
        case "childNodes":
          //case [tail]:
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

if (!document.getElementById("vdom")) document.body.setAttribute("id", "vdom");
const appRootElement = document.getElementById("vdom")!;

function vdomToRealDom(vtree: VDomNode): void {
  appRootElement.replaceChildren(vdomToRealDomRecurse(vtree, document.createElement("div")));
  afterRendering();
}

// useEffect ////////////

type OnDiffHandler<T, R = any> = (args: T, state: any) => R;
type OnRefHandler<T, R = any> = (elementRefs: Record<string, HTMLElement>, args: T, state: any, rerenderFn: () => void) => R;
type EffectHolder<T, R = any> = DiffEffectHolder<T, R> | RefEffectHolder<T, R>;

interface DiffEffectHolder<T, R = any> {
  effectType: "diff";
  oldArgs: T;
  newArgs: T;
  callback: OnDiffHandler<T, R>;
  then: (what: OnDiffHandler<T, R>) => any;
}

interface RefEffectHolder<T, R = any> {
  effectType: "elRef";
  oldArgs: T;
  newArgs: T;
  callback: OnRefHandler<T, R>;
  then: (what: OnRefHandler<T>) => any;
}

let effectsToRun = new Set<VDomNode>();

function newEmptyEffect(effectType: EffectHolder<any, any>["effectType"]): EffectHolder<any[], any> {
  const effect = { effectType, oldArgs: [NaN], callback: doNothing } as any;
  effect.then = (what: OnDiffHandler<any[]>) => (effect.callback = what);
  return effect;
}

function onSomething(effectType: EffectHolder<any, any>["effectType"], ...newArgs: any[]) {
  if (!currentVDomNode.effects) currentVDomNode.effects = [];
  const i = ++currentVDomNode.nthEffect;
  if (!currentVDomNode.effects[i]) currentVDomNode.effects[i] = newEmptyEffect(effectType);
  currentVDomNode.effects[i].newArgs = newArgs;
  effectsToRun.add(currentVDomNode);
  return currentVDomNode.effects[i];
}

function onDiff(...newArgs: any[]): DiffEffectHolder<typeof newArgs> {
  return onSomething("diff", ...newArgs) as DiffEffectHolder<typeof newArgs>;
}

function onReady(...newArgs: any[]): RefEffectHolder<typeof newArgs> {
  return onSomething("elRef", ...newArgs) as RefEffectHolder<typeof newArgs>;
}

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
              const retval = (effect.callback as OnDiffHandler<typeof effect.newArgs>)(effect.newArgs, vdom.state);
              if (retval instanceof Promise) {
                console.log("ASYNC");
                //scheduleRerender();
                retval.finally(scheduleRerender);
              }
              // retval instanceof Promise ? retval.finally(scheduleRerender) : scheduleRerender(); // TODO this might be right
              break;
            case "elRef":
              (effect.callback as OnRefHandler<typeof effect.newArgs>)(vdom.statefulElements || {}, effect.newArgs, vdom.state, scheduleRerender);
              break;
          }
        }
      }
  }
  effectsToRun.clear();
}

// closure components ////////////

type IProps = Record<any, any>;
type IState = Record<any, any>;

type Primitives = boolean | undefined | null | string | number | bigint;

interface ComponentDefinition<P extends IProps = IProps, S extends IState = IState> {
  (props: P, state: S, children?: any[]): ShallowVDomNode<P, S> | Primitives | Promise<ShallowVDomNode<P, S> | Primitives>;
  testid?: string;
}

declare interface Promise<T> {
  handled?: boolean;
}

const head = Symbol("head");
const tail = Symbol("tail");

interface ShallowVDomNode<P extends IProps = IProps, S extends IState = IState> {
  [head]: HTMLElement["tagName"] | ComponentDefinition<P, S> | undefined | null | "";
  [tail]?: ShallowVDomNode[];
  [key: string]: any;
}

const primitiveTypes = ["bigint", "string", "symbol", "boolean", "number", "undefined", "null", "array"];

let currentVDomNode: VDomNode;

function newEmptyVDom(): VDomNode {
  return { tag: "", attributes: {}, state: {}, nthEffect: -1 };
}

function componentToVDom(sel: ShallowVDomNode, oldReturnValue?: VDomNode): VDomNode | undefined {
  oldReturnValue ||= newEmptyVDom();
  oldReturnValue.nthEffect = -1;
  currentVDomNode = oldReturnValue;
  const compFn = typeof sel[head] == "function" ? sel[head] : () => sel;
  let shallowdom = compFn(sel, oldReturnValue.state, sel[tail]) ?? { [head]: "" };
  // console.log({ shallowdom });
  if (shallowdom instanceof Promise) {
    if (oldReturnValue.state.render) shallowdom = oldReturnValue.state.render as ShallowVDomNode;
    else if (!shallowdom.handled) {
      // console.log("!handled");
      shallowdom.handled = true;
      shallowdom.then(render => {
        // console.log("setting state.render");
        oldReturnValue.state.render = render;
        scheduleRerender();
        return render;
      });
      return oldReturnValue;
    } else return oldReturnValue;
    // console.log("continuing with ", { shallowdom });
  }
  if (typeof shallowdom === "string") return shallowdom as any;
  if (typeof shallowdom === "boolean") return shallowdom as any;
  if (typeof shallowdom === "number") return shallowdom as any;
  if (typeof shallowdom === "bigint") return shallowdom as any;
  if (typeof shallowdom === "symbol") return shallowdom as any;
  if (typeof shallowdom === "undefined") return shallowdom as any;
  if (Array.isArray(shallowdom)) return shallowdom as any;
  oldReturnValue.attributes = shallowdom;

  // data-testid
  if (typeof sel[head] == "function") {
    if (!sel[head].testid) {
      const fnDef: string = sel[head].toString();
      sel[head].testid = fnDef.startsWith("function ") ? fnDef.slice(9, fnDef.indexOf("(")) : "component" + fnDef.slice(0, fnDef.indexOf(")") + 1);
    }
    if (!oldReturnValue.attributes) oldReturnValue.attributes = {};
    oldReturnValue.attributes["data-testid"] = sel[head].testid;
  }

  // recurse
  oldReturnValue.children = (shallowdom[tail] || []).map((child, i) =>
    primitiveTypes.includes(typeof child) ? (child as any) : componentToVDom(child, oldReturnValue!.children?.[i])
  );

  if (typeof shallowdom[head] === "string") {
    oldReturnValue.tag = shallowdom[head];
    return oldReturnValue;
  }
  return componentToVDom(shallowdom, oldReturnValue);
}

let freshVDom: VDomNode | undefined = undefined;
let topAppComponent: ShallowVDomNode | undefined = undefined;
let scheduledRerenders = 0;

function start(app: ShallowVDomNode) {
  topAppComponent = app;
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

function jsx(tag: ShallowVDomNode[typeof head], propsOrAttributes: IProps, ...rest: ShallowVDomNode[]): ShallowVDomNode {
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

function For(props: { each: any[] }, state: IState, children: ShallowVDomNode[]): ShallowVDomNode | undefined {
  //console.log("<For />", props, state, children);
  const stampedOut = props.each.flatMap(value => children.map(child => cloneAndStamp(child, value)));
  return { [head]: "div", [tail]: stampedOut, class: "lkj" };
}

function Writer(): ShallowVDomNode {
  //console.log("Writer invoked");
  const message = "hello world ";

  onReady().then((elements, args, state, rerenderFn) => {
    console.log("REF ELEMENTS", { elements, args, state });
    elements.rememberme.focus();
    state.elements = elements;
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
      { [head]: For, each: [0, 1], [tail]: [{ [head]: "div", "data-testid": "looped", class: "looper" }] },
    ],
  };
}

function MainContent({ buttonLabel }: { buttonLabel: string }, state: Record<string, any>): ShallowVDomNode {
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
      { [head]: "button", type: "button", textContent: buttonLabel, onClick },
    ],
  };
}

async function Eventually(): Promise<ShallowVDomNode> {
  console.log("Eventually");
  await wait(3000);
  console.log("Timeup");
  return <h2>Here!</h2>;
}

function OldEventually(props: IProps, state: IState): ShallowVDomNode {
  onDiff().then(async () => {
    console.log("FETCHING...");
    state.render = <div>fetching...</div>;
    await wait(3000);
    console.log("FETCHED");
    state.render = <h2>Here!</h2>;
  });

  console.log("state.render=", state.render);
  return state.render;
}

function Layout({ buttonLabel, style }: { buttonLabel: string; style: string }): ShallowVDomNode {
  //return { [head]: "div", [tail]: [{ [head]: MainMenu }, { [head]: MainContent, props: { buttonLabel } }] };
  return (
    <div style={style}>
      <OldEventually />
      <MainMenu />
      <MainContent buttonLabel={buttonLabel} />
    </div>
  );
}

////

start(<Layout buttonLabel="Push me" style="background-color: blue" />);
//start(<Eventually />);
