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
- easy onDiff(x,y,z).then([x,y,z] => { ... }) is natural -- you're diffing the args and calling the func when they're different, and the .then implies it happens later
- easy onReady() works similarly but is for getting references to the HTMLElements just rendered (and hence, the .then makes sense and is necessary). Moreover the elements captured are the elements with a .name which most input elements will have anyway, and it's easy to add a .name to a div for getting clientBoundingRect
- it stores and remembers .name elements so they are not recycled so fast.
- added some jsx but it's without the full react typings.
- added if and iff for conditional dropping the component. the first display:none and the 2nd never renders
- loops magically work

### towatch

- an element with both `name` and `if` will have the initial value of the `if` cached, never to change again?
- in the script tag "module" was ignored, it's type="module", and it turns on CORS for file:// access and is not happy. I cannot use modern import/export keywords except with type="module" or a libary for cjs/systemjs/etc

### todo

- loops & ifs that are friendly to animation-exit.
- component return Promise
