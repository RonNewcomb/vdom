## VDOM

Simple ui framework that uses a virtual dom in-between the component definitions and the real DOM.

Function components are passed a state as well as props. The state is attached to the vDom.

Run with `tsc --watch` and open index.html as a local file from the browser.

### other

- Why separate state from props? Why not have a function send a future prop value to itself?
- state could pass a fn setX(val) or set('prop',val)
- cant destructure state cause you'd be changing a local copy
- ShallowVDomNode type should match .jsx
- easy data-testid is cool
- easy onDiff(x,y,z).then(([x,y,z]) => { ... }) is natural -- you're diffing the args and calling the func when they're different, and the .then implies it happens later
- easy onReady() works similarly but is for getting references to the HTMLElements just rendered (and hence, the .then makes sense and is necessary). Moreover the elements captured are the elements with a .name which most input elements will have anyway, and it's easy to add a .name to a div for getting clientBoundingRect
- it stores and remembers .name elements so they are not recycled so fast.
- added some jsx but it's without the full react typings.
