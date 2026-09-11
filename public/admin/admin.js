(() => {
  "use strict";

  const TOKEN_KEY = "courier_admin_token";
  const STATUS_OPTIONS = ["CREATED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED", "FAILED"];
  const OPERATIONS = ["create", "track", "cancel"];
  const OPERATION_LABELS = { auth: "Authentication", create: "Create order", track: "Track shipment", cancel: "Cancel order" };
  const OPERATION_PATH_HINTS = {
    auth: "e.g. /auth/login -- body can use {{username}} / {{password}}",
    create: "e.g. /shipments",
    track: "e.g. /shipments/{{courier_order_id}} or /track?awb={{awb_number}}",
    cancel: "e.g. /shipments/{{courier_order_id}}/cancel",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const tokenGate = $("#token-gate");
  const app = $("#app");
  const viewList = $("#view-list");
  const viewForm = $("#view-form");
  const couriersBody = $("#couriers-body");
  const form = $("#courier-form");
  const endpointForm = $("#endpoint-form");
  const selected = new Set();

  let couriers = [];
  let current = null; // the courier being edited (null on the "add" page)


  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/v1/admin${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`,
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showGate("Invalid or expired token.");
      throw new Error("unauthorized");
    }
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : null;
    if (!res.ok) {
      const fields = body?.error?.details?.fields;
      const detail = Array.isArray(fields) ? `: ${fields.map((f) => `${f.field} ${f.message}`).join(", ")}` : "";
      throw new Error((body?.error?.message || `Request failed (${res.status})`) + detail);
    }
    return body?.data;
  }

  function showGate(errorMessage) {
    tokenGate.hidden = false;
    app.hidden = true;
    const err = $("#token-error");
    err.hidden = !errorMessage;
    if (errorMessage) err.textContent = errorMessage;
  }

  function showApp() {
    tokenGate.hidden = true;
    app.hidden = false;
    render();
  }

  $("#token-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = $("#token-input").value.trim();
    if (!value) return;
    localStorage.setItem(TOKEN_KEY, value);
    showApp();
  });

  $("#logout-btn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    showGate();
  });


  function currentRoute() {
    const hash = location.hash.replace(/^#/, "");
    if (hash === "/new") return { name: "new" };
    const m = hash.match(/^\/edit\/([^/]+)(\/endpoints)?$/);
    if (m) return { name: "edit", id: decodeURIComponent(m[1]), tab: m[2] ? "endpoints" : "details" };
    return { name: "list" };
  }

  function render() {
    const route = currentRoute();
    if (route.name === "list") {
      viewForm.hidden = true;
      viewList.hidden = false;
      loadCouriers();
      return;
    }
    viewList.hidden = true;
    viewForm.hidden = false;
    if (route.name === "new") openCourierPage(null, "details");
    else openCourierPage(route.id, route.tab);
  }

  window.addEventListener("hashchange", render);


  async function loadCouriers() {
    couriersBody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading…</td></tr>`;
    try {
      couriers = await api("/couriers");
      selected.clear();
      renderTable();
    } catch (err) {
      if (err.message !== "unauthorized") {
        couriersBody.innerHTML = `<tr><td colspan="6" class="error">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  function missingEndpoints(c) {
    if (c.kind !== "generic_rest") return [];
    return OPERATIONS.filter((op) => !c.config?.endpoints?.[op]);
  }

  function renderTable() {
    if (!couriers.length) {
      couriersBody.innerHTML = `<tr><td colspan="6" class="empty-state">No couriers yet. Click "+ Add courier" to register one.</td></tr>`;
      return;
    }
    couriersBody.innerHTML = couriers
      .map((c) => {
        const missing = missingEndpoints(c);
        return `
      <tr data-id="${c.id}">
        <td><input type="checkbox" class="row-select" data-id="${c.id}" ${selected.has(c.id) ? "checked" : ""} /></td>
        <td class="courier-name">${escapeHtml(c.display_name)}</td>
        <td><code>${escapeHtml(c.id)}</code></td>
        <td><span class="badge ${c.kind}">${c.kind === "code" ? "Coded adapter" : "Generic REST"}</span></td>
        <td>
          <div class="status-cell">
            <label class="switch">
              <input type="checkbox" class="enable-toggle" data-id="${c.id}" ${c.enabled ? "checked" : ""} />
              <span class="slider"></span>
            </label>
            <span class="pill ${c.enabled ? "enabled" : "disabled"}"><span class="dot"></span>${c.enabled ? "Active" : "Inactive"}</span>
            ${missing.length ? `<span class="pill warn" title="Missing: ${missing.join(", ")}">${3 - missing.length}/3 endpoints</span>` : ""}
          </div>
        </td>
        <td class="row-actions">
          <a href="#/edit/${encodeURIComponent(c.id)}"><button type="button" class="ghost small">Edit</button></a>
          <button class="ghost small danger delete-btn" data-id="${c.id}">Delete</button>
        </td>
      </tr>`;
      })
      .join("");
    updateBulkBar();
  }

  function updateBulkBar() {
    $("#bulk-bar").hidden = selected.size === 0;
    $("#bulk-count").textContent = `${selected.size} selected`;
    $("#select-all").checked = couriers.length > 0 && selected.size === couriers.length;
  }

  $("#select-all").addEventListener("change", (e) => {
    selected.clear();
    if (e.target.checked) couriers.forEach((c) => selected.add(c.id));
    renderTable();
  });

  couriersBody.addEventListener("change", async (e) => {
    if (e.target.classList.contains("row-select")) {
      const id = e.target.dataset.id;
      e.target.checked ? selected.add(id) : selected.delete(id);
      updateBulkBar();
    }
    if (e.target.classList.contains("enable-toggle")) {
      try {
        await api(`/couriers/${e.target.dataset.id}/enable`, { method: "PATCH", body: JSON.stringify({ enabled: e.target.checked }) });
      } catch (err) {
        alert(err.message);
      }
      await loadCouriers();
    }
  });

  couriersBody.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("delete-btn")) return;
    const id = e.target.dataset.id;
    if (!confirm(`Delete "${id}"? It stops accepting orders immediately and disappears from this list. This can't be undone from the UI.`)) return;
    try {
      await api(`/couriers/${id}`, { method: "DELETE" });
      await loadCouriers();
    } catch (err) {
      alert(err.message);
    }
  });

  $("#bulk-enable-btn").addEventListener("click", () => bulkSetEnabled(true));
  $("#bulk-disable-btn").addEventListener("click", () => bulkSetEnabled(false));
  async function bulkSetEnabled(enabled) {
    try {
      await api("/couriers/bulk-enable", { method: "POST", body: JSON.stringify({ ids: Array.from(selected), enabled }) });
      await loadCouriers();
    } catch (err) {
      alert(err.message);
    }
  }

  $("#refresh-btn").addEventListener("click", loadCouriers);



  async function openCourierPage(id, tab) {
    $("#readonly-note").hidden = true;
    $("#form-error").hidden = true;
    $("#test-result").hidden = true;
    endpointForm.hidden = true;

    current = null;
    if (id) {
      try {
        current = await api(`/couriers/${id}`);
      } catch (err) {
        showReadonly("Courier not found", err.message);
        return;
      }
    }

    $("#form-title").textContent = current ? `Edit ${current.display_name}` : "Add courier";

    const hasEndpointsTab = !!current && Array.isArray(current.endpoint_operations);
    if (!hasEndpointsTab) tab = "details";
    $("#courier-tabs").hidden = !hasEndpointsTab;
    if (hasEndpointsTab) {
      const detailsLink = $("#tab-link-details");
      const endpointsLink = $("#tab-link-endpoints");
      detailsLink.href = `#/edit/${encodeURIComponent(current.id)}`;
      endpointsLink.href = `#/edit/${encodeURIComponent(current.id)}/endpoints`;
      detailsLink.classList.toggle("active", tab === "details");
      endpointsLink.classList.toggle("active", tab === "endpoints");
    }

    $("#tab-details").hidden = tab !== "details";
    $("#tab-endpoints").hidden = tab !== "endpoints";

    if (tab === "details") fillDetailsForm(current);
    else renderEndpointsTab();
  }

  function showReadonly(title, message) {
    $("#form-title").textContent = title;
    $("#tab-details").hidden = true;
    $("#tab-endpoints").hidden = true;
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $("#readonly-note").hidden = false;
    $("#readonly-note").textContent = message;
  }


  $("#auth-type").addEventListener("change", (e) => {
    $$(".auth-fields").forEach((el) => (el.hidden = el.dataset.auth !== e.target.value));
  });

  function fillDetailsForm(courier) {
    form.reset();
    $$(".auth-fields").forEach((el) => (el.hidden = el.dataset.auth !== "none"));
    $("#field-id").disabled = !!courier;
    $("#edit-secret-hint").hidden = !courier;
    $("#save-courier-btn").textContent = courier ? "Save changes" : "Save";

    const isCode = courier?.kind === "code";
    $("#connection-fields").hidden = isCode;
    $("#auth-section").hidden = isCode;
    $("#code-fields").hidden = !isCode;
    $("#code-adapter-hint").hidden = !isCode;
    $("#code-endpoints").hidden = !isCode || Array.isArray(courier?.endpoint_operations);
    form.base_url.required = !isCode;
    if (!courier) return;

    form.id.value = courier.id;
    form.display_name.value = courier.display_name;

    if (isCode) {
      const cfg = courier.config || {};
      $("#code-fields").innerHTML = courier.fields
        .map(
          (f) => `
        <label class="${f.type === "url" ? "full" : ""}">${escapeHtml(f.label)}${f.help ? ` <span class="hint">${escapeHtml(f.help)}</span>` : ""}
          <input name="cf_${f.key}" type="${f.type}" value="${escapeHtml(cfg[f.key] ?? "")}" ${f.type === "number" ? 'step="any"' : ""} />
        </label>`
        )
        .join("");
      $("#code-endpoint-list").innerHTML = (courier.endpoints || [])
        .map(
          (ep) => `
        <div class="endpoint-row">
          <span class="endpoint-op">${escapeHtml(ep.operation)}</span>
          <div class="endpoint-meta">
            <code><span class="method-tag">${escapeHtml(ep.method)}</span>${escapeHtml(ep.path)}</code>
            ${ep.note ? `<span class="hint">${escapeHtml(ep.note)}</span>` : ""}
          </div>
        </div>`
        )
        .join("");
      return;
    }

    const cfg = courier.config;
    form.base_url.value = cfg.base_url;
    form.timeout_ms.value = cfg.timeout_ms;
    form.retry_max_attempts.value = cfg.retry.max_attempts;

    form.auth_type.value = cfg.auth.type;
    form.auth_type.dispatchEvent(new Event("change"));
    if (cfg.auth.type === "api_key_header") {
      form.auth_header_name.value = cfg.auth.header_name;
      form.auth_api_key.value = cfg.auth.api_key;
    }
    if (cfg.auth.type === "basic") {
      form.auth_username.value = cfg.auth.username;
      form.auth_password.value = cfg.auth.password;
    }
    if (cfg.auth.type === "bearer_static") form.auth_token.value = cfg.auth.token;
    if (cfg.auth.type === "login_bearer") {
      form.auth_login_path.value = cfg.auth.login_path;
      form.auth_login_method.value = cfg.auth.login_method;
      form.auth_login_username.value = cfg.auth.username;
      form.auth_login_password.value = cfg.auth.password;
      form.auth_login_body.value = JSON.stringify(cfg.auth.body_template, null, 2);
      form.auth_token_path.value = cfg.auth.token_path;
      form.auth_bearer_header_name.value = cfg.auth.header_name;
    }
  }

  function parseJsonField(el, label) {
    const raw = el.value.trim();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  }

  function buildAuth(f) {
    switch (f.auth_type.value) {
      case "api_key_header":
        return { type: "api_key_header", header_name: f.auth_header_name.value, api_key: f.auth_api_key.value };
      case "basic":
        return { type: "basic", username: f.auth_username.value, password: f.auth_password.value };
      case "bearer_static":
        return { type: "bearer_static", token: f.auth_token.value };
      case "login_bearer":
        return {
          type: "login_bearer",
          login_path: f.auth_login_path.value,
          login_method: f.auth_login_method.value,
          body_template: parseJsonField(f.auth_login_body, "Login body template") || {},
          username: f.auth_login_username.value,
          password: f.auth_login_password.value,
          token_path: f.auth_token_path.value,
          header_name: f.auth_bearer_header_name.value || "Authorization",
        };
      default:
        return { type: "none" };
    }
  }

  function buildDetailsConfig(f) {
    if (current?.kind === "code") {
      const config = {};
      current.fields.forEach((field) => {
        const raw = f[`cf_${field.key}`].value;
        config[field.key] = field.type === "number" ? Number(raw) : raw;
      });
      return config;
    }
    return {
      base_url: f.base_url.value,
      timeout_ms: Number(f.timeout_ms.value) || 8000,
      retry: { max_attempts: Number(f.retry_max_attempts.value) || 3, base_delay_ms: 300 },
      auth: buildAuth(f),
      endpoints: current?.config?.endpoints || {},
      status_map: current?.config?.status_map || {},
    };
  }

  $("#test-connection-btn").addEventListener("click", async () => {
    const resultEl = $("#test-result");
    resultEl.hidden = false;
    resultEl.className = "test-result";
    resultEl.textContent = "Testing…";
    try {
      const config = buildDetailsConfig(form);
      const result = await api("/couriers/test", { method: "POST", body: JSON.stringify({ config, id: current?.id }) });
      resultEl.className = `test-result ${result.ok ? "ok" : "fail"}`;
      resultEl.textContent = result.message;
    } catch (err) {
      resultEl.className = "test-result fail";
      resultEl.textContent = err.message;
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#form-error");
    errorEl.hidden = true;
    try {
      const config = buildDetailsConfig(form);
      if (current) {
        await api(`/couriers/${current.id}`, {
          method: "PUT",
          body: JSON.stringify({ display_name: form.display_name.value, config }),
        });
        location.hash = "#/";
      } else {
        await api("/couriers", {
          method: "POST",
          body: JSON.stringify({ id: form.id.value.toLowerCase(), display_name: form.display_name.value, config }),
        });
        location.hash = "#/";
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });


  const isCoded = () => current?.kind === "code";
  const operationsFor = () => current?.endpoint_operations || OPERATIONS;

  function renderEndpointsTab() {
    const endpoints = current.config.endpoints || {};
    const ops = operationsFor();
    $("#endpoint-list").innerHTML = ops.map((op) => {
      const ep = endpoints[op];
      if (!ep) {
        return `
        <div class="endpoint-row missing" data-op="${op}">
          <span class="endpoint-op">${OPERATION_LABELS[op]}</span>
          <span class="hint">Not configured</span>
          <div class="row-actions"><button type="button" class="small ep-add" data-op="${op}">Add</button></div>
        </div>`;
      }
      const resp = ep.response || {};
      const mapping = [
        resp.token_path && `token: ${resp.token_path}`,
        resp.courier_order_id_path && `id: ${resp.courier_order_id_path}`,
        resp.awb_path && `awb: ${resp.awb_path}`,
        resp.status_path && `status: ${resp.status_path}`,
      ].filter(Boolean);
      const notes = [];
      if (mapping.length) notes.push(`response → ${mapping.join(" · ")}`);
      const mapCount = Object.keys(ep.status_map || {}).length;
      if (mapCount) notes.push(`${mapCount} status mapping${mapCount === 1 ? "" : "s"}`);
      if (isCoded() && !ep.body_template && op !== "track") notes.push("body: built-in mapping");
      if (isCoded() && !mapping.length) notes.push("response: built-in extraction");
      return `
        <div class="endpoint-row" data-op="${op}">
          <span class="endpoint-op">${OPERATION_LABELS[op]}</span>
          <div class="endpoint-meta">
            <code><span class="method-tag">${escapeHtml(ep.method)}</span>${escapeHtml(ep.path)}</code>
            ${notes.length ? `<span class="hint">${escapeHtml(notes.join(" · "))}</span>` : ""}
          </div>
          <div class="row-actions">
            <button type="button" class="ghost small ep-edit" data-op="${op}">Edit</button>
            <button type="button" class="ghost small danger ep-delete" data-op="${op}">${isCoded() ? "Reset" : "Delete"}</button>
          </div>
        </div>`;
    }).join("");

    const allConfigured = ops.every((op) => endpoints[op]);
    $("#add-endpoint-btn").disabled = allConfigured;
    $("#add-endpoint-btn").title = allConfigured ? "All endpoints are configured" : "";

  }

  $("#endpoint-list").addEventListener("click", async (e) => {
    const op = e.target.dataset.op;
    if (!op) return;
    if (e.target.classList.contains("ep-add")) openEndpointEditor(op, null);
    if (e.target.classList.contains("ep-edit")) openEndpointEditor(op, current.config.endpoints[op]);
    if (e.target.classList.contains("ep-delete")) {
      const question = isCoded()
        ? `Reset the "${OPERATION_LABELS[op]}" endpoint to this adapter's built-in default?`
        : `Remove the "${OPERATION_LABELS[op]}" endpoint? Orders needing it will fail until it's added again.`;
      if (!confirm(question)) return;
      try {
        current = await api(`/couriers/${current.id}/endpoints/${op}`, { method: "DELETE" });
        endpointForm.hidden = true;
        renderEndpointsTab();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  $("#add-endpoint-btn").addEventListener("click", () => {
    const next = operationsFor().find((op) => !current.config.endpoints?.[op]);
    if (next) openEndpointEditor(next, null);
  });

  $("#ep-cancel-btn").addEventListener("click", () => {
    endpointForm.hidden = true;
  });

  $("#ep-operation").addEventListener("change", (e) => syncEndpointFields(e.target.value));

  function syncEndpointFields(op) {
    $("#ep-path-hint").textContent = OPERATION_PATH_HINTS[op];
    $$("#ep-response-fields label").forEach((label) => {
      label.hidden = !label.dataset.for.split(" ").includes(op);
    });
    $("#ep-body-hint").textContent =
      op === "auth"
        ? 'e.g. {"username": "{{username}}", "password": "{{password}}"}'
        : isCoded()
          ? "leave empty to keep this adapter's built-in mapping; fill in to override it"
          : 'reference unified fields, e.g. {"ref": "{{order_id}}", "weight": "{{package.weightKg}}"}';
    $("#ep-status-map").hidden = !(op === "create" || op === "track");
    if (!endpointForm.ep_method.dataset.touched) endpointForm.ep_method.value = op === "track" ? "GET" : "POST";
  }

  function openEndpointEditor(op, existing) {
    endpointForm.reset();
    delete endpointForm.ep_method.dataset.touched;
    $("#ep-error").hidden = true;
    $("#endpoint-form-title").textContent = existing ? `Edit: ${OPERATION_LABELS[op]}` : `Add: ${OPERATION_LABELS[op]}`;

    const select = $("#ep-operation");
    select.innerHTML = operationsFor()
      .map((o) => `<option value="${o}" ${!existing && current.config.endpoints?.[o] && o !== op ? "disabled" : ""}>${OPERATION_LABELS[o]}</option>`)
      .join("");
    select.value = op;
    select.disabled = !!existing;
    syncEndpointFields(op);

    if (existing) {
      endpointForm.ep_method.value = existing.method;
      endpointForm.ep_path.value = existing.path;
      endpointForm.ep_body.value = existing.body_template ? JSON.stringify(existing.body_template, null, 2) : "";
      endpointForm.ep_resp_token.value = existing.response?.token_path || "";
      endpointForm.ep_resp_order_id.value = existing.response?.courier_order_id_path || "";
      endpointForm.ep_resp_awb.value = existing.response?.awb_path || "";
      endpointForm.ep_resp_status.value = existing.response?.status_path || "";
    }

    const ownMap = existing?.status_map || {};
    renderStatusMapRows(Object.keys(ownMap).length ? ownMap : current.config.status_map || {});

    endpointForm.hidden = false;
    endpointForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  endpointForm.ep_method.addEventListener("change", (e) => (e.target.dataset.touched = "1"));

  endpointForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("#ep-error");
    errorEl.hidden = true;
    const op = $("#ep-operation").value;
    try {
      const response = {};
      if (endpointForm.ep_resp_token.value && op === "auth") response.token_path = endpointForm.ep_resp_token.value;
      if (endpointForm.ep_resp_order_id.value && op === "create") response.courier_order_id_path = endpointForm.ep_resp_order_id.value;
      if (endpointForm.ep_resp_awb.value && op === "create") response.awb_path = endpointForm.ep_resp_awb.value;
      if (endpointForm.ep_resp_status.value && op !== "cancel") response.status_path = endpointForm.ep_resp_status.value;

      const endpoint = {
        path: endpointForm.ep_path.value,
        method: endpointForm.ep_method.value,
        body_template: parseJsonField(endpointForm.ep_body, "Request body template"),
        response,
        status_map: op === "create" || op === "track" ? statusMapFromRows() : {},
      };
      current = await api(`/couriers/${current.id}/endpoints/${op}`, { method: "PUT", body: JSON.stringify(endpoint) });
      endpointForm.hidden = true;
      renderEndpointsTab();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });


  function renderStatusMapRows(map) {
    $("#status-map-rows").innerHTML = "";
    Object.entries(map).forEach(([k, v]) => addStatusRow(k, v));
  }

  $("#add-status-row").addEventListener("click", () => addStatusRow("", "CREATED"));

  function addStatusRow(courierStatus, ourStatus) {
    const row = document.createElement("div");
    row.className = "status-map-row";
    row.innerHTML = `
      <input class="status-key" placeholder="courier status, e.g. in_transit" value="${escapeHtml(courierStatus)}" />
      <select class="status-value">${STATUS_OPTIONS.map((s) => `<option ${s === ourStatus ? "selected" : ""}>${s}</option>`).join("")}</select>
      <button type="button" class="ghost small icon-btn remove-row">×</button>
    `;
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    $("#status-map-rows").appendChild(row);
  }

  function statusMapFromRows() {
    const map = {};
    $$(".status-map-row").forEach((row) => {
      const key = row.querySelector(".status-key").value.trim().toLowerCase();
      if (key) map[key] = row.querySelector(".status-value").value;
    });
    return map;
  }


  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  if (getToken()) showApp();
  else showGate();
})();
