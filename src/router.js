// Navigation between views by URL hash. Setting the same hash again fires
// no event, so navigate() calls the handler directly in that case.
let handler = null;

export function setNavigator(fn) {
  handler = fn;
}

export function navigate(name) {
  if (window.location.hash === '#' + name) {
    if (handler) handler(name);
  } else {
    window.location.hash = '#' + name;
  }
}
