// virtual dom

interface VDomNode {
  tag: HTMLElement["tagName"];
  attributes: Record<string, any>;
  children?: VDomNode[];
  state: IState;
  effects?: EffectHolder<any[]>[];
  nthEffect: number;
  statefulElements?: Record<number, HTMLElement>;
}

function vdomToRealDomRecurse(vtree: VDomNode, parentElement: HTMLElement): HTMLElement {
  const elName = vtree.attributes.name;
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
    } else
      switch (attributeName) {
        case "textContent":
          el.textContent = attributeValue;
          break;
        case "tag":
        case "tagName":
        case "head":
          break;
        case "children":
        case "childNodes":
        case "tail":
          break;
        case "value":
          el.setAttribute(attributeName, attributeValue); // attribute because property would erase user's current value
          break;
        default:
          el.setAttribute(attributeName, attributeValue);
          break;
      }
  }
  if (vtree.children?.length) for (const child of vtree.children) vdomToRealDomRecurse(child, el);
  return el;
}

function vdomToRealDom(vtree: VDomNode): void {
  (document.getElementById("vdom") || document.body).replaceChildren(vdomToRealDomRecurse(vtree, document.createElement("div")));
  afterRendering();
}

// useEffect ///

type OnDiffHandler<T, R = any> = (args: T) => R;

interface EffectHolder<T> {
  oldArgs: T;
  newArgs: T;
  callback: OnDiffHandler<T>;
  then: (what: OnDiffHandler<T>) => any;
}

const doNothing = () => void 0;

let diffsToDo = new Set<VDomNode>();

function newEmptyEffect(): EffectHolder<any[]> {
  const effect = { oldArgs: [], callback: doNothing } as any;
  effect.then = (what: OnDiffHandler<any[]>) => (effect.callback = what);
  return effect;
}

function onDiff(...newArgs: any[]): EffectHolder<typeof newArgs> {
  if (!currentVDomNode.effects) currentVDomNode.effects = [];
  const i = ++currentVDomNode.nthEffect;
  if (!currentVDomNode.effects[i]) currentVDomNode.effects[i] = newEmptyEffect();
  currentVDomNode.effects[i].newArgs = newArgs;
  diffsToDo.add(currentVDomNode);
  return currentVDomNode.effects[i];
}

function afterRendering() {
  for (const vdom of diffsToDo) {
    if (vdom.effects)
      for (const effect of vdom.effects) {
        const somethingChanged = effect.oldArgs.some((arg, i) => !Object.is(arg, effect.newArgs[i]));
        effect.oldArgs = effect.newArgs;
        if (somethingChanged) {
          const retval = effect.callback(effect.newArgs);
          // retval instanceof Promise ? retval.finally(scheduleRerender) : scheduleRerender(); // TODO this might be right
        }
      }
  }
  diffsToDo.clear();
}

// closure components

type IProps = Record<keyof any, any>;
type IState = Record<keyof any, any>;

interface ComponentDefinition<P extends IProps = IProps, S extends IState = IState> {
  (props: P, state: S): ShallowVDomNode;
  testid?: string;
}

interface ShallowVDomNode extends Record<string, any> {
  head: HTMLElement["tagName"] | ComponentDefinition;
  tail?: ShallowVDomNode[];
  props?: IProps;
}

let currentVDomNode: VDomNode;

function newEmptyVDom(): VDomNode {
  return { tag: "", attributes: {}, state: {}, nthEffect: -1 };
}

function componentToVDom(sel: ShallowVDomNode, oldReturnValue?: VDomNode): VDomNode {
  oldReturnValue ||= newEmptyVDom();
  oldReturnValue.nthEffect = -1;
  currentVDomNode = oldReturnValue;
  const compFn = typeof sel.head == "function" ? sel.head : () => sel;
  const shallowdom = compFn(sel.props || {}, oldReturnValue.state);
  oldReturnValue.attributes = shallowdom;

  // data-testid
  if (typeof sel.head == "function") {
    if (!sel.head.testid) {
      const fnDef: string = sel.head.toString();
      sel.head.testid = fnDef.startsWith("function ") ? fnDef.slice(9, fnDef.indexOf("(")) : "component" + fnDef.slice(0, fnDef.indexOf(")") + 1);
    }
    oldReturnValue.attributes["data-testid"] = sel.head.testid;
  }

  // recurse
  oldReturnValue.children = (shallowdom.tail || []).map((child, i) => componentToVDom(child, oldReturnValue!.children?.[i]));
  delete oldReturnValue.attributes.tail;

  if (typeof shallowdom.head === "string") {
    oldReturnValue.tag = shallowdom.head;
    delete oldReturnValue.attributes.head;
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

function scheduleRerender() {
  scheduledRerenders++;
  Promise.resolve().then(() => !--scheduledRerenders && rerender());
}

function rerender() {
  if (scheduledRerenders) return; // a later promise is already in the queue
  freshVDom = componentToVDom(topAppComponent!, freshVDom);
  if (scheduledRerenders) return; // if above line called scheduleRerender(), don't commit to real dom
  vdomToRealDom(freshVDom!);
}

// jsx stand-in

function _jsx(head: ShallowVDomNode["head"], props?: IProps, tail?: ShallowVDomNode[]): ShallowVDomNode {
  const retval = props || {};
  retval.head = head;
  retval.tail = tail;
  retval.props = props;
  return retval as ShallowVDomNode;
}

// sample components

const Writer: ComponentDefinition = (props, state) => {
  console.log("Writer invoked");
  const message = "hello world ";
  return <ShallowVDomNode>{ head: "input", value: message, name: "rememberme" };
};
Writer.testid = "writer";

const MainMenu: ComponentDefinition = (props, state) => {
  return <ShallowVDomNode>{
    head: "ul",
    tail: [
      { head: "li", textContent: "item 1" },
      { head: "li", tail: [{ head: Writer }] },
    ],
  };
};
MainMenu.testid = "mainmenu";

const MainContent: ComponentDefinition = ({ buttonLabel }, state) => {
  console.log("MainContent.props", buttonLabel);

  const onClick = () => {
    state.counter = (state.counter || 0) + 1;
    alert("counter at " + state.counter);
  };

  if (!(state.counter % 3)) state.triple = state.triple ? state.triple + 1 : 1;

  onDiff(state.triple).then(async vals => {
    await Promise.resolve(0);
    console.log("USEEFFECT 3rd", vals, "counter=", state.counter);
  });

  return <ShallowVDomNode>{
    head: "div",
    class: "mx-b",
    id: "contentroot",
    tail: [
      { head: "span", style: "font-weight:bold", textContent: "in a span " + (state.counter || 0) + " triple " + state.triple },
      { head: "button", type: "button", textContent: buttonLabel, onClick },
    ],
  };
};

const Layout: ComponentDefinition = ({ buttonLabel }, state) => {
  console.log("Layout.props", buttonLabel);
  return <ShallowVDomNode>{ head: "div", tail: [{ head: MainMenu }, { head: MainContent, props: { buttonLabel } }] };
};
Layout.testid = "layout";

////

start({ head: Layout, props: { buttonLabel: "Pushe`" }, style: "background-color:blue" });

//////

// const sampleTree: VDomNode = {
//   tag: "div",
//   state: {},
//   attributes: { class: "mx-b", id: "root" },
//   children: [
//     { tag: "span", attributes: { style: "font-weight:bold", textContent: "in a span" }, state: {} },
//     { tag: "button", attributes: { type: "button", textContent: "Click Me", onClick: "alert('foo')" }, state: {} },
//   ],
// };

//vdomToRealDom(sampleTree);
