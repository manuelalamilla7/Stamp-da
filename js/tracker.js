/**
 * LP Tracker
 * Captura UTMs, envía formularios a un webhook y publica un evento en dataLayer.
 */
(function (window, document) {
  "use strict";

  var CONFIG = {
    formSelector: "form.lead-form",
    defaultWebhook: "https://hooks.zapier.com/hooks/catch/27072868/445smet/",
    defaultRedirect: "gracias.html",
    eventName: "lp_lead_submit",
    storageKey: "tracking_params",
    redirectDelay: 800
  };

  var TRACKING_PARAMS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "utm_id",
    "gclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "ad_id",
    "li_fat_id",
    "msclkid",
    "ttclid"
  ];

  function clean(value) {
    return value === null || value === undefined ? "" : String(value).trim();
  }

  function safeJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function captureTrackingParams() {
    var stored = {};

    try {
      stored = safeJson(window.localStorage.getItem(CONFIG.storageKey), {});
    } catch (_) {}

    var params = new URLSearchParams(window.location.search);
    var updated = Object.assign({}, stored);
    var hasTracking = false;

    TRACKING_PARAMS.forEach(function (key) {
      var value = clean(params.get(key));
      if (value) {
        updated[key] = value;
        hasTracking = true;
      }
    });

    if (hasTracking) {
      updated.captured_at = new Date().toISOString();
      updated.landing_url = window.location.href;
      updated.referrer = document.referrer || "";

      try {
        window.localStorage.setItem(CONFIG.storageKey, JSON.stringify(updated));
      } catch (_) {}
    }

    return updated;
  }

  function getTrackingParams() {
    try {
      return safeJson(window.localStorage.getItem(CONFIG.storageKey), {});
    } catch (_) {
      return {};
    }
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }

    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function serializeForm(form) {
    var payload = {};
    var data = new FormData(form);

    data.forEach(function (value, key) {
      if (typeof File !== "undefined" && value instanceof File) return;

      value = clean(value);

      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        payload[key] = Array.isArray(payload[key])
          ? payload[key].concat(value)
          : [payload[key], value];
      } else {
        payload[key] = value;
      }
    });

    Object.keys(payload).forEach(function (key) {
      if (Array.isArray(payload[key])) payload[key] = payload[key].join(", ");
    });

    return payload;
  }

  function buildPayload(form) {
    var payload = serializeForm(form);
    var tracking = getTrackingParams();

    Object.keys(tracking).forEach(function (key) {
      payload[key] = tracking[key];
    });

    payload.lead_id = createId();
    payload.form_id = form.dataset.lpFormId || form.id || "lead-form";
    payload.form_origin = form.dataset.lpFormOrigin || payload.form_id;
    payload.page_url = window.location.href;
    payload.page_path = window.location.pathname;
    payload.page_title = document.title;
    payload.referrer = document.referrer || "";
    payload.submitted_at = new Date().toISOString();

    return payload;
  }

  function toBody(payload) {
    var body = new URLSearchParams();

    Object.keys(payload).forEach(function (key) {
      body.append(key, clean(payload[key]));
    });

    return body;
  }

  function dispatchWebhook(url, payload) {
    var body = toBody(payload);

    if (navigator.sendBeacon) {
      var blob = new Blob([body.toString()], {
        type: "application/x-www-form-urlencoded;charset=UTF-8"
      });

      if (navigator.sendBeacon(url, blob)) {
        return Promise.resolve(true);
      }
    }

    return fetch(url, {
      method: "POST",
      mode: "no-cors",
      keepalive: true,
      body: body
    }).then(function () {
      return true;
    });
  }

  function createGtmEvent(payload) {
    return {
      event: CONFIG.eventName,
      lead_id: payload.lead_id,
      form_id: payload.form_id,
      form_origin: payload.form_origin,
      page_path: payload.page_path,
      utm_source: payload.utm_source || "",
      utm_medium: payload.utm_medium || "",
      utm_campaign: payload.utm_campaign || ""
    };
  }

  function pushGtmEvent(payload) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(createGtmEvent(payload));
  }

  function pushGtmEventAndRedirect(payload, redirectUrl) {
    window.dataLayer = window.dataLayer || [];

    var redirected = false;
    var go = function () {
      if (redirected) return;
      redirected = true;
      window.location.assign(redirectUrl);
    };

    var eventData = createGtmEvent(payload);
    eventData.eventCallback = go;
    eventData.eventTimeout = CONFIG.redirectDelay;

    window.dataLayer.push(eventData);
    window.setTimeout(go, CONFIG.redirectDelay);
  }

  function getRedirect(form) {
    var value = clean(form.dataset.lpRedirect);
    if (value.toLowerCase() === "none") return "";
    return value || CONFIG.defaultRedirect;
  }

  function onSubmit(event) {
    var form = event.target;

    if (!(form instanceof HTMLFormElement)) return;
    if (!form.matches(CONFIG.formSelector)) return;
    if (form.dataset.lpIgnore === "true") return;

    var webhook = clean(form.dataset.lpWebhook) || CONFIG.defaultWebhook;
    if (!webhook) return;

    var redirect = getRedirect(form);
    var payload = buildPayload(form);

    if (redirect) event.preventDefault();

    dispatchWebhook(webhook, payload)
      .then(function () {
        if (redirect) {
          pushGtmEventAndRedirect(payload, redirect);
        } else {
          pushGtmEvent(payload);
        }
      })
      .catch(function (error) {
        console.error("[LP Tracker] No fue posible enviar el formulario:", error);
      });
  }

  captureTrackingParams();
  document.addEventListener("submit", onSubmit, true);
})(window, document);
