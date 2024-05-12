"use strict";
let topAppElement = document.body;
let topAppComponent = undefined;
let freshVDom = undefined;
let currentVDomNode;
let scheduledRerenders = 0;
let effectsToRun = new Set();
let globalState = { styles: {} };
function start(appComponent, rootElement) {
    topAppComponent = appComponent;
    topAppElement = rootElement;
    if (!topAppElement) {
        topAppElement = document.createElement("div");
        document.body.insertBefore(topAppElement, document.body.firstChild);
    }
    scheduleRerender();
}
function scheduleRerender() {
    scheduledRerenders++;
    Promise.resolve().then(() => {
        scheduledRerenders--;
        if (scheduledRerenders)
            return;
        freshVDom = componentToVDomRecurse(topAppComponent, freshVDom);
        if (scheduledRerenders)
            return;
        const freshElements = vdomToElementsRecurse(freshVDom, document.createElement("div"));
        topAppElement.replaceChildren(freshElements);
        let somethingChanged = false;
        for (const effect of effectsToRun) {
            if (effect.oldArgs.length === effect.newArgs.length && effect.oldArgs.every((arg, i) => Object.is(arg, effect.newArgs[i])))
                continue;
            somethingChanged = true;
            effect.oldArgs = effect.newArgs;
            const retval = effect.callback(effect.newArgs, effect.state, scheduleRerender);
            if (retval instanceof Promise)
                retval.finally(scheduleRerender);
        }
        effectsToRun.clear();
        if (somethingChanged)
            scheduleRerender();
    });
}
const head = Symbol("head");
const tail = Symbol("tail");
const rendered = Symbol("rendered");
function componentToVDomRecurse(aFunctionAndItsInputs, vnode) {
    if (typeof aFunctionAndItsInputs !== "object")
        return aFunctionAndItsInputs;
    if (typeof vnode !== "object" && vnode != undefined)
        return vnode;
    vnode ||= { tag: "", attributes: {}, state: aFunctionAndItsInputs, nthEffect: -1 };
    vnode.nthEffect = -1;
    currentVDomNode = vnode;
    let outputFromAFunction = typeof aFunctionAndItsInputs[head] == "function" ? aFunctionAndItsInputs[head].call(vnode.state, aFunctionAndItsInputs) : aFunctionAndItsInputs;
    if (!outputFromAFunction || typeof outputFromAFunction !== "object")
        return outputFromAFunction;
    const vnodeInClosure = vnode;
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
        outputFromAFunction = vnode.state[rendered];
    }
    vnode.tag = typeof outputFromAFunction[head] === "string" ? outputFromAFunction[head] : undefined;
    vnode.attributes = outputFromAFunction;
    vnode.children = (outputFromAFunction[tail] || []).map((child, i) => componentToVDomRecurse(child, vnodeInClosure.children?.[i]));
    if (typeof aFunctionAndItsInputs[head] == "function") {
        if (typeof aFunctionAndItsInputs[head].testid != "string") {
            const fnDef = aFunctionAndItsInputs[head].toString();
            aFunctionAndItsInputs[head].testid = fnDef.startsWith("function ") ? fnDef.slice(9, fnDef.indexOf("(")) : "";
        }
        if (aFunctionAndItsInputs[head].testid)
            vnode.attributes["data-testid"] = aFunctionAndItsInputs[head].testid;
    }
    return typeof vnode.tag === "string" ? vnode : componentToVDomRecurse(outputFromAFunction, vnode);
}
const ifNotNode = document.createComment("!iff");
const nullNode = document.createComment("null");
function vdomToElementsRecurse(vtree, parentElement) {
    if (Array.isArray(vtree) || typeof vtree !== "object")
        return parentElement.appendChild(document.createTextNode(vtree));
    if (!vtree || !vtree.tag)
        return parentElement.appendChild(nullNode);
    const elName = vtree.attributes?.name;
    if (vtree.attributes && !vtree.attributes.iff && Object.hasOwn(vtree.attributes, "iff"))
        return parentElement.appendChild(ifNotNode);
    if (elName) {
        if (!vtree.state.names)
            vtree.state.names = {};
        if (!vtree.state.names[elName])
            vtree.state.names[elName] = document.createElement(vtree.tag);
    }
    const el = elName ? vtree.state.names[elName] : document.createElement(vtree.tag);
    parentElement.appendChild(el);
    for (const attributeName in vtree.attributes) {
        const attributeValue = vtree.attributes[attributeName];
        if (attributeName.startsWith("on")) {
            const eventName = attributeName.slice(2).toLowerCase();
            el.addEventListener(eventName, attributeValue);
            el.addEventListener(eventName, scheduleRerender);
        }
        else {
            switch (attributeName) {
                case "innerText":
                case "textContent":
                    el.innerText = attributeValue;
                    break;
                case "if":
                    if (!attributeValue)
                        el.setAttribute("style", "display:none!important");
                    break;
                case "iff":
                    break;
                case "names":
                    break;
                case "style":
                    const s = typeof attributeValue === "object"
                        ? Object.keys(attributeValue)
                            .map(key => `${key}:${attributeValue[key]}`)
                            .join(";")
                        : attributeValue;
                    el.setAttribute("style", s);
                    break;
                case "value":
                    el.setAttribute(attributeName, attributeValue);
                    break;
                default:
                    el.setAttribute(attributeName, attributeValue);
                    break;
            }
        }
    }
    if (vtree.children?.length)
        for (const child of vtree.children)
            vdomToElementsRecurse(child, el);
    return el;
}
function onDiff(...newArgs) {
    if (!currentVDomNode.effects)
        currentVDomNode.effects = [];
    const i = ++currentVDomNode.nthEffect;
    if (!currentVDomNode.effects[i]) {
        const newEffect = { oldArgs: [NaN], callback: doNothing, state: currentVDomNode.state };
        newEffect.then = (what) => (newEffect.callback = what);
        currentVDomNode.effects[i] = newEffect;
    }
    currentVDomNode.effects[i].newArgs = newArgs;
    effectsToRun.add(currentVDomNode.effects[i]);
    return currentVDomNode.effects[i];
}
const onReady = onDiff;
function jsx(tag, propsOrAttributes, ...rest) {
    propsOrAttributes ||= {};
    propsOrAttributes[head] = tag;
    propsOrAttributes[tail] = rest;
    return propsOrAttributes;
}
const doNothing = () => void 0;
function css(name, props) {
    if (globalState.styles[name])
        return name;
    const el = document.createElement("style");
    el.id = name;
    el.innerText = `.${name}{${props}}`;
    document.head.appendChild(el);
    globalState.styles[name] = el;
    return name;
}
const outsideCss = css("outsideCss", "display:block");
const FlexRow = ({ [tail]: children }) => {
    const flexRowCss = css("flexRow", "display:flex");
    return { [head]: "flex-row", class: flexRowCss, [tail]: children };
};
const For = ({ each, [tail]: children }) => children && each && children.length && each.length
    ? {
        [head]: "for-each",
        [tail]: each.flatMap(value => children.map(child => {
            const retval = { ...child };
            retval.if = true;
            retval.name = value;
            return retval;
        })),
    }
    : undefined;
function Writer() {
    const message = "hello world ";
    onReady().then((args, state, rerenderFn) => {
        console.log("REF ELEMENTS", { args, state });
        state.names?.rememberme.focus();
    });
    return jsx("input", { name: "rememberme", value: message });
}
function MainMenu() {
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
function MainContent({ buttonLabel }) {
    console.log("maincontent this, state", { buttonLabel, this: this });
    const onClick = () => {
        this.counter = (this.counter || 0) + 1;
        alert("counter at " + this.counter);
        if (!(this.counter % 3))
            this.triple = this.triple ? this.triple + 1 : 1;
    };
    onDiff(this.triple).then(async ([triple], state) => {
        await Promise.resolve(0);
        console.log("USEEFFECT 3rd", triple, "counter=", state.counter);
    });
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
const wait = (milliseconds = 0) => new Promise(r => setTimeout(r, milliseconds));
async function Eventually() {
    console.log("Eventually");
    await wait(3000);
    console.log("Timeup");
    return jsx("h2", null, "Here!");
}
function OldEventually(mostlyItsInputs) {
    onDiff().then(async () => {
        console.log("FETCHING...");
        mostlyItsInputs.result = jsx("div", null, "fetching...");
        await wait(3000);
        console.log("FETCHED");
        mostlyItsInputs.result = jsx("h2", null, "Here!");
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
function Layout({ buttonLabel, style }) {
    return (jsx("div", { style: style },
        jsx(TopMenu, null),
        jsx(MainMenu, null),
        jsx(MainContent, { buttonLabel: buttonLabel }),
        jsx(Footer, null)));
}
start(jsx(Layout, { buttonLabel: "Push me", style: "background-color: blue" }), document.getElementById("vdom"));
