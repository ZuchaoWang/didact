// JSX will be transformed to a call to createElement with proper arguments
// this call will produce an object
// text element will also be represented by object
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map(child =>
        typeof child === "object"
          ? child
          : createTextElement(child)
      ),
    },
  }
}

function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  }
}

// create actual dom element based on fiber of a host component
// where a fiber corresponds to an element, together with its binding dom, and action to be peformed on dom
// this is not directly used for function component
function createDom(fiber) {
  const dom =
    fiber.type == "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type)

  updateDom(dom, {}, fiber.props)

  return dom
}

const isEvent = key => key.startsWith("on")
const isProperty = key =>
  key !== "children" && !isEvent(key)
const isNew = (prev, next) => key =>
  prev[key] !== next[key]
const isGone = (prev, next) => key => !(key in next)

// update dom attrs when dom created or modified
function updateDom(dom, prevProps, nextProps) {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(
      key =>
        !(key in nextProps) ||
        isNew(prevProps, nextProps)(key)
    )
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.removeEventListener(
        eventType,
        prevProps[name]
      )
    })

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = ""
    })

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      dom[name] = nextProps[name]
    })

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.addEventListener(
        eventType,
        nextProps[name]
      )
    })
}

// commit is the action to make change visible to user
// this is the last part of work of update that must be performed synchronously
// it is triggered in workLoop
function commitRoot() {
  deletions.forEach(commitWork)
  commitWork(wipRoot.child)
  currentRoot = wipRoot
  wipRoot = null
}

// commit on one fiber
// operation on dom can be place, update or delete dom
// then traverse the fiber structure: first child, first child's first child, first child's second child, second child, sibling, ...
// this is actually the second round of traversal (the first round is performed asynchronously in performOneUnitOfWork)
function commitWork(fiber) {
  if (!fiber) {
    return
  }

  let domParentFiber = fiber.parent
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent
  }
  const domParent = domParentFiber.dom

  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    domParent.appendChild(fiber.dom)
  } else if (
    fiber.effectTag === "UPDATE" &&
    fiber.dom != null
  ) {
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props
    )
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent)
  }

  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) { // if has dom, this is a host component, directly corresponding to one html tag
    domParent.removeChild(fiber.dom)
  } else { // if no dom, this must be a function component, which only has one child fiber, so recursively delete its only child
    commitDeletion(fiber.child, domParent)
  }
}

// render root element on root container
// will only be called once, intialize fiber stuffs
function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  }
  deletions = []
  nextUnitOfWork = wipRoot
}

// set this to non-null to trigger workLoop for rerender
let nextUnitOfWork = null

// current finished root; if in the middle of a series of performUnitOfWork, will be previous root
let currentRoot = null

// current work-in-progress root, in the middle of a series of performUnitOfWork; after all performUnitOfWork will set currentRoot = wipRoot
let wipRoot = null

// doms to delete from old fiber
let deletions = null

// runs periodically in the background
// do prepration works in chunks via a series of performUnitOfWork: create new dom for new fiber, record update/deletion in old fiber
// but the final commitRoot can not be interrupted, which append all new doms to currentRoot and do the update/deletion
function workLoop(deadline) {
  let shouldYield = false
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(
      nextUnitOfWork
    )
    shouldYield = deadline.timeRemaining() < 1
  }

  // !nextUnitOfWork means no work can be done before commit
  // wipRoot != null means we do have something to commit
  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  requestIdleCallback(workLoop)
}

requestIdleCallback(workLoop)

function performUnitOfWork(fiber) {
  const isFunctionComponent =
    fiber.type instanceof Function
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)
  } else {
    updateHostComponent(fiber)
  }
  // next work on child
  if (fiber.child) {
    return fiber.child
  }
  // if no child, next work on sibling, or parent's sibling, or parent's parent's sibling
  // stop when arrive at root
  let nextFiber = fiber
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling
    }
    nextFiber = nextFiber.parent
  }
}

// used by nearest parent fiber that is function component
// setup in that function component's performUnitOfWork, won't be changed by children that is not function component
let wipFiber = null
let hookIndex = null

function updateFunctionComponent(fiber) {
  wipFiber = fiber
  hookIndex = 0
  wipFiber.hooks = []
  // execute the function, and the jsx-defined html become its only child
  // here type is the function component, the function is called with props to produce the child createElement
  const children = [fiber.type(fiber.props)]
  reconcileChildren(fiber, children)
}

function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex] // fiber remembers state via index
  const hook = {
    state: oldHook ? oldHook.state : initial, // state will be initial only for new fiber, otherwise use old fiber's remembered value
    queue: [], // queue is used to remember all state-updates actions, to be performed in one batch during next useState
  }

  // state update applied in next rerender's performUnitOfWork -> updateFunctionComponent -> execute function
  const actions = oldHook ? oldHook.queue : []
  actions.forEach(action => {
    hook.state = action(hook.state)
  })

  // notice here action is a function: oldState => newState
  // does not support constant
  const setState = action => {
    // this queue remembers state-update action, later to be performed in batch in useState; so repeated setState will not take effect until useState is called
    // this merges update, but still ensures next useState see the correct state value
    // normally useState is only called once in component, so this update will wait until next rerender calls useState, and that is usually asynchronous (see below)
    hook.queue.push(action) 
    // setState will update nextUnitOfWork so workLoop will pick it up to rerender automatically
    // it seems that multiple actions will only lead to one rerender, because workLoop does not run immediately
    // workLoop only runs when idle, so it's triggered asynchronously
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    }
    nextUnitOfWork = wipRoot
    deletions = []
  }

  wipFiber.hooks.push(hook)
  hookIndex++ // hook identified by hookIndex
  return [hook.state, setState]
}

function updateHostComponent(fiber) {
  // parent fiber has already identified whether this child fiber is update or create
  // for update case fiber.dom will be old fiber, so no createDom
  // only for create case will fiber.dom be null, leading to createDom
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }
  reconcileChildren(fiber, fiber.props.children)
}

// reconciliation called in performUnitOfWork
// it does not create new dom
// but it marks child fiber's effectTag as PLACEMENT, and such child fiber will then create dom in its updateHostComponent, if it's not function component
// it also marks fiber for update/deletion
// the while loop reach the end of max(elements.length, oldFiber sibling length), missing element or oldFiber will be null
// this is also the only place to set up fiber.alternate for none-root fiber, actually it's set up by parent fiber for its child fiber
// fiber.alternate will be oldFiber, and only setup for update case
// fiber.alternate will be used for child to later get its own old child, or old hook values in performUnitOfWork, or update props in commit phase
function reconcileChildren(wipFiber, elements) {
  // this wipFiber argument is not the global wipFiber, it does not change the global wipFiber
  // should be renamed to avoid confusion
  let index = 0
  let oldFiber =
    wipFiber.alternate && wipFiber.alternate.child
  let prevSibling = null

  while (
    index < elements.length ||
    oldFiber != null
  ) {
    const element = elements[index]
    let newFiber = null

    const sameType =
      oldFiber &&
      element &&
      element.type == oldFiber.type

    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      }
    }
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      }
    }
    if (oldFiber && !sameType) {
      oldFiber.effectTag = "DELETION"
      deletions.push(oldFiber)
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }

    if (index === 0) {
      wipFiber.child = newFiber
    } else if (element) {
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }
}

const Didact = {
  createElement,
  render,
  useState,
}

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1)
  return (
    <h1 onClick={() => setState(c => c + 1)}>
      Count: {state}
    </h1>
  )
}
const element = <Counter />
const container = document.getElementById("root")
Didact.render(element, container)
