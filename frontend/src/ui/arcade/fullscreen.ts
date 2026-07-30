/**
 * One narrow compatibility door for the Fullscreen API. Older WebKit engines
 * expose prefixed members, and some browsers throw synchronously instead of
 * returning a rejected promise when policy denies a request.
 */

interface WebkitFullscreenDocument extends Document {
  readonly webkitFullscreenElement?: Element | null;
  readonly webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export function fullscreenElement(doc: Document = document): Element | null {
  const webkitDoc = doc as WebkitFullscreenDocument;
  return doc.fullscreenElement ?? webkitDoc.webkitFullscreenElement ?? null;
}

export function fullscreenAvailable(element: HTMLElement, doc: Document = document): boolean {
  const webkitDoc = doc as WebkitFullscreenDocument;
  const webkitElement = element as WebkitFullscreenElement;
  const policyAllows =
    doc.fullscreenEnabled !== false || webkitDoc.webkitFullscreenEnabled === true;
  const canRequest =
    typeof element.requestFullscreen === "function" ||
    typeof webkitElement.webkitRequestFullscreen === "function";
  const canExit =
    typeof doc.exitFullscreen === "function" ||
    typeof webkitDoc.webkitExitFullscreen === "function";
  return policyAllows && canRequest && canExit;
}

export function requestFullscreen(element: HTMLElement): Promise<void> {
  const webkitElement = element as WebkitFullscreenElement;
  const request =
    typeof element.requestFullscreen === "function"
      ? element.requestFullscreen.bind(element)
      : webkitElement.webkitRequestFullscreen?.bind(webkitElement);
  if (!request) return Promise.reject(new Error("Fullscreen is unavailable"));

  try {
    return Promise.resolve(request());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function exitFullscreen(doc: Document = document): Promise<void> {
  const webkitDoc = doc as WebkitFullscreenDocument;
  const exit =
    typeof doc.exitFullscreen === "function"
      ? doc.exitFullscreen.bind(doc)
      : webkitDoc.webkitExitFullscreen?.bind(webkitDoc);
  if (!exit) return Promise.reject(new Error("Fullscreen is unavailable"));

  try {
    return Promise.resolve(exit());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function subscribeFullscreen(
  listener: () => void,
  doc: Document = document
): () => void {
  doc.addEventListener("fullscreenchange", listener);
  doc.addEventListener("webkitfullscreenchange", listener);
  return () => {
    doc.removeEventListener("fullscreenchange", listener);
    doc.removeEventListener("webkitfullscreenchange", listener);
  };
}
