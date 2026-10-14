// Runs in the page's MAIN world so it can call WaterlooWorks' own global
// functions. Classic script, no imports: a content script registered with
// "world": "MAIN" cannot be an ES module. Talks to the content script
// (ISOLATED world, see ../adapter/ww.js) over window.postMessage, tagged
// "wmj" on both sides, with event.source checked to reject other senders.
//
// Assumption, unconfirmed against a real WaterlooWorks page (see
// docs/research/waterlooworks-surface.md, "How to get the data"): the page
// defines window.getPostingOverview(jobId, cb), window.getPostingData(jobId,
// cb) and window.getWorkTermRatingReportJson(divId, cb), each taking a
// callback as the final argument and calling it once with the result. If the
// real functions return a promise instead, or take arguments in a different
// order, this file is the one to fix.
(function () {
  var TAG = 'wmj';
  var ALLOWED = {
    getPostingOverview: true,
    getPostingData: true,
    getWorkTermRatingReportJson: true,
  };

  function respond(id, result, error) {
    window.postMessage(
      { tag: TAG, direction: 'response', id: id, result: result, error: error || null },
      '*'
    );
  }

  function callGlobal(name, args, id) {
    var fn = window[name];
    if (typeof fn !== 'function') {
      respond(id, null, 'wmj: ' + name + ' is not defined on this page');
      return;
    }
    var finished = false;
    var callback = function (result) {
      if (finished) return;
      finished = true;
      respond(id, result, null);
    };
    try {
      var maybeReturn = fn.apply(window, (args || []).concat([callback]));
      // Some pages may return the value directly instead of using a
      // callback. If the function returned something and never called back,
      // fall back to that value after a short delay.
      if (typeof maybeReturn !== 'undefined') {
        setTimeout(function () {
          if (!finished) {
            finished = true;
            respond(id, maybeReturn, null);
          }
        }, 50);
      }
    } catch (err) {
      respond(id, null, 'wmj: ' + name + ' threw ' + (err && err.message ? err.message : String(err)));
    }
  }

  // Remembers the last results request WaterlooWorks' own table sent
  // (a POST to the board with isDataViewer=true and a page number), so the
  // content script can ask for the other pages with exactly the same
  // fields. Only the address and form body are kept; the browser adds the
  // login cookie by itself on every request.
  var listingRequest = null;
  function noteRequest(url, body) {
    try {
      if (typeof body !== 'string') return;
      if (body.indexOf('isDataViewer=true') === -1 || !/(^|&)page=/.test(body)) return;
      listingRequest = { url: String(url || location.href), body: body };
    } catch (err) {
      // never let this get in the page's way
    }
  }
  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__wmjUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    noteRequest(this.__wmjUrl, body);
    return xhrSend.apply(this, arguments);
  };
  if (typeof window.fetch === 'function') {
    var pageFetch = window.fetch;
    window.fetch = function (input, init) {
      noteRequest(typeof input === 'string' ? input : input && input.url, init && init.body);
      return pageFetch.apply(this, arguments);
    };
  }

  // WaterlooWorks' own table, a Vue app the page declares with
  // "let dataViewerApp", so it is reachable by name but not on window.
  function viewerApp() {
    try {
      // eslint-disable-next-line no-undef
      return typeof dataViewerApp !== 'undefined' ? dataViewerApp : null;
    } catch (err) {
      return null;
    }
  }

  // Runs WaterlooWorks' own Apply for one posting, the same call its row
  // menu makes (dataViewerApp.createApplication). That asks the server for
  // the posting's application form, then either opens the apply page in a
  // new tab or shows WaterlooWorks' "additional step" popup first. It looks
  // the posting up in the rows its own table has loaded, which only covers
  // the page of results on screen, so for any other posting this hands it
  // the few fields its Apply code reads. Answers { started, modal } once the
  // server replies, or { started: false } when the page has no such app.
  function startApply(id, args) {
    var app = viewerApp();
    if (!app || typeof app.createApplication !== 'function') {
      respond(id, { started: false }, null);
      return;
    }
    var postingId = args[0];
    var title = args[1] || '';
    var done = false;
    var stop = null;
    var finish = function (result) {
      if (done) return;
      done = true;
      if (stop) stop();
      respond(id, result, null);
    };
    try {
      app.selectedPostingRowAppData = undefined;
      stop = app.$watch('selectedPostingRowAppData', function (got) {
        if (got) finish({ started: true, modal: !!got.modalContent });
      });
      app.createApplication(postingId);
      if (!app.selectedPostingRow) {
        app.selectedPostingRow = {
          id: postingId,
          data: { JobTitle: { value: { postingTitle: title } }, hasApplication: { value: false } },
        };
      }
    } catch (err) {
      finish({ started: false, error: err && err.message ? err.message : String(err) });
      return;
    }
    setTimeout(function () {
      finish({ started: true, modal: false, unconfirmed: true });
    }, 10000);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.tag !== TAG || data.direction !== 'request') return;
    if (data.type === 'wmjListingRequest') {
      respond(data.id, listingRequest, null);
      return;
    }
    if (data.type === 'wmjStartApply') {
      startApply(data.id, data.args || []);
      return;
    }
    if (data.type === 'wmjApplyModalOpen') {
      var shown = false;
      try { shown = !!(viewerApp() && viewerApp().applyModal); } catch (err) { shown = false; }
      respond(data.id, shown, null);
      return;
    }
    if (!ALLOWED[data.type]) return;
    callGlobal(data.type, data.args, data.id);
  });
})();
