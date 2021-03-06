/**
 * @callback predicate
 * @param {A} x
 * @return {boolean}
 * @template A
 */

/**
 * @param {predicate<A>} f
 * @param {ReadonlyArray<A>} xs
 * @template A
 * @return {ReadonlyArray<A>}
 */
const dropWhile = (f, xs) => (xs.length ? dropWhileNotEmpty(f, xs) : []);

/**
 * @param {predicate<A>} f
 * @param {ReadonlyArray<A>} xs
 * @template A
 * @return {ReadonlyArray<A>}
 */
const dropWhileNotEmpty = (f, [x, ...xs]) =>
  f(x) ? dropWhile(f, xs) : [x, ...xs];

/**
 * @param {predicate<A>} f
 * @param {ReadonlyArray<A>} xs
 * @template A
 * @return {ReadonlyArray<A>}
 */
const takeWhile = (f, xs) => (xs.length ? takeWhileNotEmpty(f, xs) : []);

/**
 * @param {predicate<A>} f
 * @param {ReadonlyArray<A>} xs
 * @template A
 * @return {ReadonlyArray<A>}
 */
const takeWhileNotEmpty = (f, [x, ...xs]) =>
  f(x) ? [x, ...takeWhile(f, xs)] : [];

/**
 * @param {ReadonlyArray<A>} xs
 * @template A
 * @return {A | undefined}
 */
const last = xs => xs[xs.length - 1]; // eslint-disable-line no-array-subscript

// TODO https://github.com/danielnixon/link-fixer/issues/13
const defaultTabPosition = "relatedAfterCurrent";

const getOptions = () =>
  new Promise(resolve => chrome.storage.sync.get(items => resolve(items)));

const tabPositions = {
  /**
   * @param {chrome.tabs.Tab} senderTab
   * @param {ReadonlyArray<chrome.tabs.Tab>} tabs
   * @return {number|undefined}
   */
  relatedAfterCurrent: (senderTab, tabs) => {
    const tabsAfterSenderTab = dropWhile(
      tab => tab.index <= senderTab.index,
      tabs
    );
    const tabsOpenedBySenderTab = takeWhile(
      tab => tab.openerTabId !== undefined && tab.openerTabId === senderTab.id,
      tabsAfterSenderTab
    );
    const lastTabOpenedBySenderTab = last(tabsOpenedBySenderTab);
    return lastTabOpenedBySenderTab
      ? lastTabOpenedBySenderTab.index + 1
      : undefined;
  },
  /**
   * @param {chrome.tabs.Tab} senderTab
   * @return {number}
   */
  afterCurrent: senderTab => senderTab.index + 1,
  /**
   * @return {number}
   */
  atEnd: () => Number.MAX_SAFE_INTEGER
};

// Respect Firefox browserSettings if we have them. (`browser` is undefined in Chrome,
// `newTabPosition` is undefined in older versions of Firefox).
// See https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/browserSettings
const newTabPosition =
  this.browser &&
  this.browser.browserSettings &&
  this.browser.browserSettings.newTabPosition;
const getNewTabPosition = () =>
  newTabPosition !== undefined
    ? newTabPosition.get({}).then(x => x.value)
    : Promise.resolve(defaultTabPosition);

/**
 * @param {chrome.tabs.Tab|undefined} senderTab
 * @param {ReadonlyArray<chrome.tabs.Tab>} tabs
 * @return {Promise<number|undefined>}
 */
const calculateNewTabIndex = (senderTab, tabs) => {
  if (senderTab) {
    return getNewTabPosition().then(newTabPosition => {
      switch (newTabPosition) {
        case "afterCurrent":
          return tabPositions.afterCurrent(senderTab);
        case "relatedAfterCurrent":
          return tabPositions.relatedAfterCurrent(senderTab, tabs);
        case "atEnd":
          return tabPositions.atEnd();
        default:
          return undefined;
      }
    });
  } else {
    return Promise.resolve(undefined);
  }
};

chrome.runtime.getPlatformInfo(info => {
  const isMac = info.os === "mac";

  chrome.runtime.onMessage.addListener((message, sender) => {
    const openInNewWindow =
      message.shiftKey && !(message.metaKey || message.ctrlKey);

    if (openInNewWindow) {
      chrome.windows.create({
        url: message.url
      });
    } else {
      // ctrl+click opens a context menu on Mac, so don't create the new tab.
      const shouldOpenTab = !(isMac && message.ctrlKey);

      if (shouldOpenTab) {
        chrome.tabs.query(
          {
            windowId: sender.tab && sender.tab.windowId
          },
          tabs => {
            calculateNewTabIndex(sender.tab, tabs).then(newTabIndex => {
              getOptions().then(options => {
                const openInForeground = options.tabPosition === "foreground";
                const active = message.shiftKey
                  ? !openInForeground
                  : openInForeground;

                chrome.tabs.create({
                  url: message.url,
                  active: active,
                  openerTabId: sender.tab && sender.tab.id,
                  index: newTabIndex
                });
              });
            });
          }
        );
      }
    }
  });
});
