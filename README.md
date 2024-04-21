## VDOM

Simple ui framework that uses a virtual dom in-between the component definitions and the real DOM.

Function components are passed a state as well as props. The state is attached to the vDom.

Run with `tsc -p . --watch` and open index.html as a local file from the browser.

### other

- Why separate state from props? Why not have a function send a future prop value to itself?
- state could pass a fn setX(val) or set('prop',val)
- cant destructure state cause you'd be changing a local copy
- ShallowVDomNode type should match .jsx
- easy data-testid is cool
