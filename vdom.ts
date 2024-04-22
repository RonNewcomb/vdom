// virtual dom

interface VDomNode {
  tag: HTMLElement["tagName"];
  attributes: Record<string, any>;
  children?: VDomNode[];
  state: IState;
}

function vdomToRealDomRecurse(vtree: VDomNode, parentElement: HTMLElement): HTMLElement {
  const el = document.createElement(vtree.tag);
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
  lifecycleHooks();
}

function onUpdate(...rest: any[]) {
  // if (false /*diff and do nothing on ==*/) return;
  let callback: (args: typeof rest) => void = () => void 0;
  return {
    then: (onFulfilled: (args: typeof rest) => void) => {
      callback = onFulfilled;
      return undefined;
    },
  };
}

function lifecycleHooks() {
  const x = 4,
    y = 6,
    z = 2;
  onUpdate(x, y, z).then(vals => {
    console.log(vals);
  });

  onUpdate([x, y, z], vals => {
    console.log(vals);
  });

  [x, y, z].onUpdate(vals => {
    console.log(vals);
  });
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

function componentToVDom(sel: ShallowVDomNode, oldReturnValue?: VDomNode): VDomNode {
  oldReturnValue ||= { tag: "", attributes: {}, state: {} };
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
  oldReturnValue.children = (shallowdom.tail || []).map((child, i) => {
    return componentToVDom(child, oldReturnValue!.children?.[i]);
  });
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
  return <ShallowVDomNode>{ head: "span", textContent: message };
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

  return <ShallowVDomNode>{
    head: "div",
    class: "mx-b",
    id: "contentroot",
    tail: [
      { head: "span", style: "font-weight:bold", textContent: "in a span " + (state.counter || 0) },
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