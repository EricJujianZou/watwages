// Classic script (Manifest V3 content scripts cannot be ES modules), so this
// file exists only to bootstrap the real module graph. Everything under
// src/ is a normal ES module reachable through this one dynamic import.
(function () {
  function report(status) {
    try {
      var sent = chrome.runtime.sendMessage({ tag: 'wmj', type: 'status', status: status });
      if (sent && sent.catch) sent.catch(function () {});
    } catch (err) {
      // the badge is a nicety, never let it break startup
    }
  }
  try {
    report('starting');
    var url = chrome.runtime.getURL('src/content.js');
    import(url).catch(function (err) {
      console.error('WatWages: failed to load content.js', err);
      report('failed');
    });
  } catch (err) {
    console.error('WatWages: content-loader failed', err);
    report('failed');
  }
})();
