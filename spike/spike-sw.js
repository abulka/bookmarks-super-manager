// Opens the probe page once, at install time, so the CDP runner can find it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('spike.html') })
})
