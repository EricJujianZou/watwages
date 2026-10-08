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
  // "Take the Tour" on the welcome tab leaves a note. Students who were
  // logged out land on the dashboard after signing in, so this finishes the
  // trip to the Full Cycle board instead of leaving them there.
  try {
    chrome.storage.local.get('wmjTourPending', function (got) {
      var at = got && got.wmjTourPending;
      if (!at) return;
      var path = location.pathname;
      var fresh = Date.now() - at < 30 * 60 * 1000;
      if (!fresh || path.indexOf('/myAccount/co-op/') === 0) {
        chrome.storage.local.remove('wmjTourPending');
      } else if (path.indexOf('/myAccount/') === 0) {
        chrome.storage.local.remove('wmjTourPending');
        location.replace('https://waterlooworks.uwaterloo.ca/myAccount/co-op/full/jobs.htm');
      }
    });
  } catch (err) {
    // never let the tour note break startup
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
