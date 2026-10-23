const crypto = require("crypto");
const http = require("http");
const agentmailBridge = require("./agentmail-bridge");
const {
  attachmentFilename,
  buildNotificationMessage,
  sendNotification
} = require("./notification");
const {
  addDays,
  buildLaunchReminderMessage,
  normalizeReminderSnapshot,
  scanLaunchReminders: scanReminderEngine,
  shanghaiDate,
  shouldRunScheduledScan
} = require("./launch-reminders");

const COLLECTION = "supplier_feedback_records";
const REMINDER_WORKSPACE_COLLECTION = "categorylab_reminder_workspaces";
const REMINDER_SNAPSHOT_COLLECTION = "categorylab_launch_reminders";
const REMINDER_DELIVERY_COLLECTION = "categorylab_reminder_deliveries";
const REMINDER_WORKSPACE_ID = "categorylab-default";
const IMAGE_LIMIT = 6;
const PUBLIC_ACTIONS = new Set([
  "ping",
  "submitSupplierFeedback"
]);
const REMINDER_HTTP_ACTIONS = new Set([
  "enableLaunchReminders",
  "syncLaunchReminders",
  "launchReminderStatus",
  "runLaunchReminderScanFromWorker"
]);
const REMINDER_DIRECT_ACTIONS = new Set([
  "scanLaunchReminders",
  "sendLaunchReminderTest"
]);
const CATEGORY_LAB_OWNER_ACCESS_DIGESTS = new Set([
  "2287a4cfed43e12623e7483ffdd5b9d580af1471d36c3df3f1295c4869d7bd78"
]);

let cachedApp;

function getApp() {
  if (cachedApp) return cachedApp;
  const cloudbase = require("@cloudbase/node-sdk");
  cachedApp = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  return cachedApp;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-CategoryLab-Admin-Code, X-CategoryLab-Access-Digest, X-CategoryLab-Reminder-Token, X-CategoryLab-Reminder-Worker-Token",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  };
}

function redirectResponse(location) {
  return {
    statusCode: 302,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Location": location
    },
    body: ""
  };
}

function parseEventBody(event = {}) {
  if (!event.body) return event || {};
  if (typeof event.body === "object") return event.body;
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return raw ? JSON.parse(raw) : {};
}

function queryParams(event = {}) {
  const direct = event.queryStringParameters || event.query || {};
  if (direct && Object.keys(direct).length) return direct;
  const rawUrl = event.url || event.path || event.rawPath || "";
  try {
    return Object.fromEntries(new URL(rawUrl, "https://example.local").searchParams.entries());
  } catch (error) {
    return {};
  }
}

function text(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "";
}

function nullableText(value) {
  const trimmed = text(value);
  return trimmed || null;
}

function quoteToNumber(value) {
  const cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableSubmissionBatchId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableBatchItemIndex(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeRecordPayload(payload = {}) {
  return {
    product_name: text(payload.product_name),
    supplier_name: text(payload.supplier_name),
    submission_batch_id: nullableSubmissionBatchId(payload.submission_batch_id),
    batch_item_index: nullableBatchItemIndex(payload.batch_item_index),
    version_label: nullableText(payload.version_label),
    sample_date: nullableText(payload.sample_date),
    product_type: nullableText(payload.product_type),
    test_category: nullableText(payload.test_category),
    campaign_year: nullableText(payload.campaign_year),
    campaign: nullableText(payload.campaign),
    maintenance_purpose: nullableText(payload.maintenance_purpose),
    project_name: nullableText(payload.project_name),
    version_change: nullableText(payload.version_change),
    finished_spec: nullableText(payload.finished_spec),
    length_mm: nullableText(payload.length_mm),
    width_mm: nullableText(payload.width_mm),
    height_mm: nullableText(payload.height_mm),
    ingredients_structure: nullableText(payload.ingredients_structure),
    image_paths: Array.isArray(payload.image_paths) ? payload.image_paths : [],
    quote_rmb: quoteToNumber(payload.quote_rmb),
    core_ingredients_selling_points: nullableText(payload.core_ingredients_selling_points),
    tasting_scene: nullableText(payload.tasting_scene),
    tasting_feedback: nullableText(payload.tasting_feedback),
    round_conclusion: nullableText(payload.round_conclusion),
    next_step_direction: nullableText(payload.next_step_direction),
    key_blocker: nullableText(payload.key_blocker),
    status: ["待处理", "已确认"].includes(payload.status) ? payload.status : "待处理"
  };
}

function sanitizePublicSubmissionPayload(payload = {}) {
  const normalized = normalizeRecordPayload(payload);
  delete normalized.quote_rmb;
  delete normalized.tasting_scene;
  delete normalized.tasting_feedback;
  delete normalized.round_conclusion;
  delete normalized.next_step_direction;
  delete normalized.key_blocker;
  delete normalized.campaign_year;
  delete normalized.campaign;
  delete normalized.maintenance_purpose;
  delete normalized.project_name;
  return normalized;
}

function normalizeFeedbackPayload(payload = {}) {
  return {
    tasting_scene: nullableText(payload.tasting_scene),
    tasting_feedback: nullableText(payload.tasting_feedback),
    round_conclusion: nullableText(payload.round_conclusion),
    next_step_direction: nullableText(payload.next_step_direction)
  };
}

function normalizeAdminUpdatePayload(payload = {}) {
  const normalized = normalizeRecordPayload(payload);
  if (Object.hasOwn(payload, "maintenance_purpose") && normalized.maintenance_purpose && !["产品改进", "产品复制"].includes(normalized.maintenance_purpose)) {
    throw new Error("老品维护测试目的请选择产品改进或产品复制。");
  }
  const patch = {};
  Object.keys(normalized).forEach(key => {
    if (Object.hasOwn(payload, key)) patch[key] = normalized[key];
  });
  if (Object.hasOwn(payload, "product_group_id")) {
    patch.product_group_id = nullableText(payload.product_group_id);
  }
  return patch;
}

function normalizeGroupingSupplier(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function validateProductGroupingRecords(records = []) {
  if (!records.length) throw new Error("没有可归组的产品记录。");
  const suppliers = new Set(records.map(record => normalizeGroupingSupplier(record.supplier_name)).filter(Boolean));
  if (suppliers.size !== 1 || records.some(record => !normalizeGroupingSupplier(record.supplier_name))) {
    throw new Error("只能合并同一供应商的产品记录。");
  }
  const brands = new Set(records.map(record => {
    const category = text(record.test_category);
    return category.startsWith("Peet's") ? "peets" : category.startsWith("Ora") ? "ora" : "legacy";
  }));
  if (brands.size > 1) throw new Error("只能合并同一品牌的产品记录，请先校准测试类别。");
  return true;
}

function requireFields(payload, names) {
  const missing = names.filter(name => !text(payload[name]));
  if (missing.length) {
    throw new Error(`缺少必填字段：${missing.join(", ")}`);
  }
}

function makeFollowupCode() {
  return `P${crypto.randomBytes(4).toString("hex").slice(0, 7)}`.toUpperCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function publicRecord(record = {}) {
  const { edit_token_hash, ...safe } = record;
  return safe;
}

function publicSubmissionRecord(record = {}) {
  const {
    campaign_year,
    campaign,
    maintenance_purpose,
    project_name,
    edit_token_hash,
    notification_status,
    notification_sent_at,
    notification_error,
    notification_test_sent_at,
    notification_test_error,
    ...safe
  } = record;
  return safe;
}

function notificationRecipients(value) {
  return String(value || "")
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function notificationConfig(env = process.env) {
  const smtpUser = text(env.MAIL_SMTP_USER);
  return {
    enabled: String(env.MAIL_NOTIFY_ENABLED || "").toLowerCase() === "true",
    smtpUser,
    smtpPass: text(env.MAIL_SMTP_PASS),
    from: `Category Lab 产品信息通知 <${smtpUser}>`,
    testTo: notificationRecipients(env.MAIL_TEST_TO)[0] || "",
    notifyTo: notificationRecipients(env.MAIL_NOTIFY_TO),
    inboxUrl: text(env.MAIL_INBOX_URL)
  };
}

function isDirectInvocation(event = {}) {
  return !(
    event.httpMethod ||
    event.path ||
    event.url ||
    event.rawPath ||
    event.requestContext?.http?.method
  );
}

function isNotificationTestAuthorized(event = {}, body = {}, env = process.env) {
  if (isDirectInvocation(event)) return true;
  const expected = text(env.CATEGORYLAB_ADMIN_CODE);
  const provided = adminCodeFromEvent(event, body);
  return Boolean(expected && provided && hashToken(expected) === hashToken(provided));
}

function notificationError(error) {
  return String(error?.message || error || "邮件发送失败。")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

async function downloadNotificationAttachments(app, record = {}) {
  const attachments = [];
  const images = Array.isArray(record.image_paths) ? record.image_paths.slice(0, IMAGE_LIMIT) : [];
  for (const [index, image] of images.entries()) {
    if (!image?.fileID) continue;
    try {
      const downloaded = await app.downloadFile({ fileID: image.fileID });
      const content = downloaded?.fileContent;
      if (!content) continue;
      attachments.push({
        filename: attachmentFilename(record, index),
        content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        contentType: text(image.type) || "image/jpeg"
      });
    } catch (error) {
      // A broken image must not block the text notification or supplier submission.
    }
  }
  return attachments;
}

async function updateNotificationMetadata(collection, id, patch) {
  try {
    await collection.doc(id).update(patch);
  } catch (error) {
    return false;
  }
  return true;
}

async function notifyRecord(app, collection, record, recipients, dependencies = {}) {
  const config = dependencies.config || notificationConfig();
  const send = dependencies.send || sendNotification;
  const mode = dependencies.mode === "test" ? "test" : "automatic";
  const now = new Date().toISOString();

  try {
    if (!config.smtpUser) throw new Error("缺少 MAIL_SMTP_USER。");
    if (!config.smtpPass) throw new Error("缺少 MAIL_SMTP_PASS。");
    if (!Array.isArray(recipients) || !recipients.length) throw new Error("缺少邮件收件人。");
    const attachments = await downloadNotificationAttachments(app, record);
    const message = buildNotificationMessage(record, {
      from: config.from,
      to: recipients,
      inboxUrl: config.inboxUrl,
      attachments
    });
    const result = await send({
      smtpUser: config.smtpUser,
      smtpPass: config.smtpPass,
      message
    });
    const patch = mode === "test"
      ? {
          notification_test_sent_at: now,
          notification_test_error: null,
          updated_at: now
        }
      : {
          notification_status: "sent",
          notification_sent_at: now,
          notification_error: null,
          updated_at: now
        };
    await updateNotificationMetadata(collection, record.id, patch);
    return { ok: true, messageId: text(result?.messageId), attachments: attachments.length };
  } catch (error) {
    const message = notificationError(error);
    const patch = mode === "test"
      ? {
          notification_test_error: message,
          updated_at: now
        }
      : {
          notification_status: "failed",
          notification_error: message,
          updated_at: now
        };
    await updateNotificationMetadata(collection, record.id, patch);
    return { ok: false, error: message };
  }
}

function databaseWriteRecord(record = {}) {
  const { _id, ...safe } = record;
  return safe;
}

function dataUrlToBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("图片数据格式不正确。");
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function generateUniqueFollowupCode(collection) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = makeFollowupCode();
    const existing = await collection.where({ followup_code: code }).limit(1).get();
    if (!existing.data?.length) return code;
  }
  throw new Error("提交编号生成失败，请重试。");
}

async function uploadImages(app, recordId, images = []) {
  const uploaded = [];
  for (const [index, image] of images.slice(0, IMAGE_LIMIT).entries()) {
    if (!image?.dataUrl) continue;
    const { buffer, mimeType } = dataUrlToBuffer(image.dataUrl);
    const suffix = mimeType.includes("png") ? "png" : "jpg";
    const cloudPath = `supplier-feedback/${recordId}/${Date.now()}-${index + 1}.${suffix}`;
    const uploadResult = await app.uploadFile({
      cloudPath,
      fileContent: buffer
    });
    const fileID = uploadResult.fileID;
    let publicUrl = "";
    if (fileID) {
      const urlResult = await app.getTempFileURL({
        fileList: [{ fileID, maxAge: 60 * 60 * 24 * 365 }]
      });
      publicUrl = urlResult.fileList?.[0]?.tempFileURL || "";
    }
    uploaded.push({
      path: cloudPath,
      fileID,
      publicUrl,
      name: text(image.name) || `产品照 ${index + 1}`,
      type: mimeType,
      size: buffer.length
    });
  }
  return uploaded;
}

function mergeImagePaths(existing = [], added = []) {
  return [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(added) ? added : [])
  ].filter(Boolean).slice(0, IMAGE_LIMIT);
}

function imagePathKey(image = {}, index = 0) {
  return text(image.fileID || image.path || image.publicUrl || image.url) || `legacy:${index}`;
}

function reconcileImagePaths(existing = [], uploaded = [], order) {
  if (!Array.isArray(order)) return mergeImagePaths(existing, uploaded);
  const existingByKey = new Map(
    (Array.isArray(existing) ? existing : []).map((image, index) => [imagePathKey(image, index), image])
  );
  const next = [];
  const usedExisting = new Set();
  const usedUploaded = new Set();

  order.forEach(item => {
    if (next.length >= IMAGE_LIMIT || !item) return;
    if (item.kind === "existing") {
      const key = text(item.key);
      if (!key || usedExisting.has(key) || !existingByKey.has(key)) return;
      usedExisting.add(key);
      next.push(existingByKey.get(key));
      return;
    }
    if (item.kind === "new") {
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0 || index >= uploaded.length || usedUploaded.has(index)) return;
      usedUploaded.add(index);
      if (uploaded[index]) next.push(uploaded[index]);
    }
  });

  return next;
}

function imageFileIDs(images = []) {
  return [...new Set((Array.isArray(images) ? images : []).map(image => text(image?.fileID)).filter(Boolean))];
}

async function deleteImageFilesQuietly(app, images = []) {
  const fileList = imageFileIDs(images);
  if (!fileList.length) return;
  try {
    await app.deleteFile({ fileList });
  } catch (error) {
    console.warn("图片文件清理失败：", error?.message || error);
  }
}

async function tempUrlForFileID(app, fileID, maxAge = 60 * 60) {
  const id = text(fileID);
  if (!id || !id.startsWith("cloud://")) throw new Error("图片 fileID 不正确。");
  const urlResult = await app.getTempFileURL({
    fileList: [{ fileID: id, maxAge }]
  });
  const file = urlResult.fileList?.[0] || {};
  const url = file.tempFileURL || file.url || "";
  if (!url) throw new Error("图片临时链接生成失败。");
  return url;
}

async function refreshImageUrls(app, imagePaths = []) {
  if (!Array.isArray(imagePaths) || !imagePaths.length) return [];
  return Promise.all(imagePaths.map(async image => {
    if (!image?.fileID) return image;
    try {
      return {
        ...image,
        publicUrl: await tempUrlForFileID(app, image.fileID)
      };
    } catch (error) {
      return image;
    }
  }));
}

async function hydrateRecordImages(app, record = {}) {
  return {
    ...record,
    image_paths: await refreshImageUrls(app, record.image_paths)
  };
}

function adminCodeFromEvent(event = {}, body = {}) {
  const headers = event.headers || {};
  return text(
    body.adminCode ||
    headers["x-categorylab-admin-code"] ||
    headers["X-CategoryLab-Admin-Code"]
  );
}

function categoryLabAccessDigestFromEvent(event = {}, body = {}) {
  const headers = event.headers || {};
  return text(
    body.categoryLabAccessDigest ||
    headers["x-categorylab-access-digest"] ||
    headers["X-CategoryLab-Access-Digest"]
  );
}

function assertAdmin(event, body, env = process.env) {
  const expected = String(env.CATEGORYLAB_ADMIN_CODE || "");
  const provided = adminCodeFromEvent(event, body);
  if (!expected || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw new Error("管理员授权失败，请重新登录。");
  }
}

function launchReminderConfig(env = process.env) {
  const smtpUser = text(env.MAIL_SMTP_USER);
  return {
    smtpUser,
    smtpPass: text(env.MAIL_SMTP_PASS),
    from: `Category Lab 档期提醒 <${smtpUser}>`,
    testTo: notificationRecipients(env.MAIL_TEST_TO)[0] || "",
    recipients: notificationRecipients(env.MAIL_LAUNCH_REMINDER_TO),
    categoryLabUrl: text(env.MAIL_CATEGORYLAB_URL) || "https://louise-ai-d2gi63mlafa5599c4-1434918374.tcloudbaseapp.com/decks/category-lab/categorylab"
  };
}

function reminderTokenFromEvent(event = {}, body = {}) {
  const headers = event.headers || {};
  return text(
    body.reminderToken ||
    headers["x-categorylab-reminder-token"] ||
    headers["X-CategoryLab-Reminder-Token"]
  );
}

function reminderWorkerTokenFromEvent(event = {}, body = {}) {
  const headers = event.headers || {};
  return text(
    body.reminderWorkerToken ||
    headers["x-categorylab-reminder-worker-token"] ||
    headers["X-CategoryLab-Reminder-Worker-Token"]
  );
}

function assertReminderWorker(event = {}, body = {}, env = process.env) {
  const configured = text(env.CATEGORYLAB_REMINDER_WORKER_TOKEN);
  const received = reminderWorkerTokenFromEvent(event, body);
  if (!configured || !received || configured !== received) throw new Error("档期提醒定时任务授权失败。");
}

function reminderSnapshotDocId(campaignId) {
  return hashToken(`${REMINDER_WORKSPACE_ID}:${text(campaignId)}`).slice(0, 40);
}

function reminderDeliveryDocId(key) {
  return hashToken(text(key)).slice(0, 40);
}

function isTimerEvent(event = {}) {
  return [event.Type, event.type, event.eventType].some(value => /timer/i.test(text(value))) ||
    /reminder/i.test(text(event.TriggerName || event.triggerName));
}

async function reminderWorkspace(app) {
  const result = await app.database().collection(REMINDER_WORKSPACE_COLLECTION).doc(REMINDER_WORKSPACE_ID).get();
  return result.data?.[0] || null;
}

async function requireReminderToken(app, event, body) {
  const token = reminderTokenFromEvent(event, body);
  const workspace = await reminderWorkspace(app);
  if (!token || !workspace?.token_hash || hashToken(token) !== workspace.token_hash) {
    throw new Error("云提醒授权无效，请重新开启云提醒。");
  }
  if (workspace.active === false) throw new Error("云提醒当前未启用。");
  return workspace;
}

async function enableLaunchReminders(app, event, body, env, now = new Date()) {
  if (!isNotificationTestAuthorized(event, body, env)) throw new Error("云提醒启用授权失败。");
  const collection = app.database().collection(REMINDER_WORKSPACE_COLLECTION);
  const existingResult = await collection.doc(REMINDER_WORKSPACE_ID).get();
  const existing = existingResult.data?.[0] || {};
  const token = crypto.randomBytes(24).toString("hex");
  const activationDate = dateText(existing.activation_date) || shanghaiDate(now);
  const timestamp = now.toISOString();
  await collection.doc(REMINDER_WORKSPACE_ID).set({
    workspace_id: REMINDER_WORKSPACE_ID,
    token_hash: hashToken(token),
    activation_date: activationDate,
    active: true,
    created_at: existing.created_at || timestamp,
    updated_at: timestamp,
    last_synced_at: existing.last_synced_at || null
  });
  return { token, activationDate };
}

function dateText(value) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

async function syncLaunchReminders(app, event, body, now = new Date()) {
  const workspace = await requireReminderToken(app, event, body);
  const rawSnapshots = Array.isArray(body.snapshots) ? body.snapshots.slice(0, 100) : [];
  const snapshots = rawSnapshots.map(normalizeReminderSnapshot).filter(snapshot => snapshot.id);
  const collection = app.database().collection(REMINDER_SNAPSHOT_COLLECTION);
  const timestamp = now.toISOString();
  const activeDocIds = new Set();
  for (const snapshot of snapshots) {
    const docId = reminderSnapshotDocId(snapshot.id);
    activeDocIds.add(docId);
    await collection.doc(docId).set({
      workspace_id: REMINDER_WORKSPACE_ID,
      campaign_id: snapshot.id,
      id: snapshot.id,
      name: snapshot.name,
      launchDate: snapshot.launchDate,
      activationDate: dateText(workspace.activation_date),
      nodes: snapshot.nodes,
      active: true,
      updated_at: timestamp
    });
  }
  const current = await collection.where({ workspace_id: REMINDER_WORKSPACE_ID }).limit(1000).get();
  for (const record of current.data || []) {
    const docId = record._id || reminderSnapshotDocId(record.campaign_id || record.id);
    if (!activeDocIds.has(docId) && record.active !== false) {
      await collection.doc(docId).update({ active: false, updated_at: timestamp });
    }
  }
  await app.database().collection(REMINDER_WORKSPACE_COLLECTION).doc(REMINDER_WORKSPACE_ID).update({
    last_synced_at: timestamp,
    updated_at: timestamp
  });
  return { synced: snapshots.length, syncedAt: timestamp };
}

async function launchReminderStatus(app, event, body) {
  const workspace = await requireReminderToken(app, event, body);
  const result = await app.database().collection(REMINDER_SNAPSHOT_COLLECTION)
    .where({ workspace_id: REMINDER_WORKSPACE_ID, active: true })
    .limit(1000)
    .get();
  return {
    enabled: true,
    campaigns: (result.data || []).length,
    activationDate: dateText(workspace.activation_date),
    lastSyncedAt: workspace.last_synced_at || null
  };
}

async function sendLaunchMail(message, config, dependencies = {}) {
  if (dependencies.sendLaunchEmail) return dependencies.sendLaunchEmail(message);
  if (!config.smtpUser) throw new Error("缺少 MAIL_SMTP_USER。");
  if (!config.smtpPass) throw new Error("缺少 MAIL_SMTP_PASS。");
  return sendNotification({ smtpUser: config.smtpUser, smtpPass: config.smtpPass, message });
}

async function runLaunchReminderScan(app, env, dependencies = {}) {
  const config = launchReminderConfig(env);
  if (!config.recipients.length) throw new Error("缺少 MAIL_LAUNCH_REMINDER_TO。");
  const database = app.database();
  const snapshotCollection = database.collection(REMINDER_SNAPSHOT_COLLECTION);
  const deliveryCollection = database.collection(REMINDER_DELIVERY_COLLECTION);
  const snapshots = await snapshotCollection.where({ workspace_id: REMINDER_WORKSPACE_ID, active: true }).limit(1000).get();
  return scanReminderEngine({
    now: dependencies.now || new Date(),
    listSnapshots: async () => snapshots.data || [],
    hasDelivery: async key => {
      const result = await deliveryCollection.doc(reminderDeliveryDocId(key)).get();
      return result.data?.[0]?.status === "sent";
    },
    recordDelivery: async delivery => {
      await deliveryCollection.doc(reminderDeliveryDocId(delivery.key)).set({
        workspace_id: REMINDER_WORKSPACE_ID,
        ...delivery,
        status: "sent"
      });
    },
    recordFailure: async failure => {
      await deliveryCollection.doc(reminderDeliveryDocId(failure.key)).set({
        workspace_id: REMINDER_WORKSPACE_ID,
        ...failure,
        status: "failed"
      });
    },
    send: message => sendLaunchMail(message, config, dependencies),
    config
  });
}

async function sendLaunchReminderTest(app, event, body, env, dependencies = {}) {
  if (!isDirectInvocation(event)) throw new Error("档期提醒测试邮件只允许腾讯云直接调用。");
  const config = launchReminderConfig(env);
  if (!config.testTo) throw new Error("缺少 MAIL_TEST_TO。");
  const now = dependencies.now || new Date();
  const today = shanghaiDate(now);
  const campaign = {
    id: "categorylab-reminder-test",
    name: "测试档期（仅 Louise 收件）",
    launchDate: addDays(today, 30)
  };
  const node = {
    key: "consumer",
    label: "众测",
    plannedDate: addDays(today, 15),
    actualDate: ""
  };
  const message = buildLaunchReminderMessage({ campaign, node, threshold: 15, remainingDays: 15 }, {
    from: config.from,
    to: [config.testTo],
    categoryLabUrl: config.categoryLabUrl
  });
  const result = await sendLaunchMail(message, config, dependencies);
  return { recipient: config.testTo, messageId: text(result?.messageId), subject: message.subject };
}

async function submitSupplierFeedback(app, collection, body) {
  const payload = sanitizePublicSubmissionPayload(body.payload);
  requireFields(payload, ["product_name", "supplier_name"]);

  const id = crypto.randomUUID();
  const editToken = crypto.randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const followupCode = await generateUniqueFollowupCode(collection);
  const imagePaths = await uploadImages(app, id, body.images || []);
  const record = {
    ...payload,
    _id: id,
    id,
    edit_token_hash: hashToken(editToken),
    followup_code: followupCode,
    image_paths: imagePaths,
    status: "待处理",
    created_at: now,
    updated_at: now
  };
  await collection.doc(id).set(databaseWriteRecord(record));
  const mailConfig = notificationConfig();
  if (mailConfig.enabled) {
    await notifyRecord(app, collection, record, mailConfig.notifyTo, { config: mailConfig });
  }
  return { id, edit_token: editToken, record: publicSubmissionRecord(record) };
}

async function sendLatestNotificationTest(app, collection, event, body) {
  if (!isNotificationTestAuthorized(event, body)) throw new Error("测试邮件授权失败。");
  const config = notificationConfig();
  if (!config.testTo) throw new Error("缺少 MAIL_TEST_TO。");
  const result = await collection.orderBy("created_at", "desc").limit(1).get();
  const record = publicRecord(result.data?.[0] || {});
  if (!record.id) throw new Error("没有可用于测试邮件的产品记录。");
  const notification = await notifyRecord(app, collection, record, [config.testTo], {
    config,
    mode: "test"
  });
  if (!notification.ok) throw new Error(notification.error || "测试邮件发送失败。");
  return {
    recordId: record.id,
    productName: record.product_name,
    recipient: config.testTo,
    messageId: notification.messageId,
    attachments: notification.attachments
  };
}

async function getByFollowupCode(collection, code) {
  const normalized = text(code).toUpperCase();
  if (!normalized) throw new Error("请填写提交编号。");
  const result = await collection.where({ followup_code: normalized }).limit(1).get();
  const record = result.data?.[0];
  if (!record) throw new Error("提交编号不存在，请检查第一段提交成功后显示的编号。");
  return publicRecord(record);
}

async function completeSupplierFeedback(collection, body) {
  const record = await getByFollowupCode(collection, body.followupCode);
  const patch = {
    ...normalizeFeedbackPayload(body.payload),
    updated_at: new Date().toISOString()
  };
  await collection.doc(record.id).update(patch);
  return publicRecord({ ...record, ...patch });
}

async function adminList(collection, event, body) {
  const result = await collection.orderBy("created_at", "desc").limit(1000).get();
  const records = await Promise.all((result.data || []).map(record => hydrateRecordImages(getApp(), publicRecord(record))));
  return { records };
}

async function adminUpdate(collection, event, body) {
  const id = text(body.id);
  if (!id) throw new Error("缺少记录 ID。");
  const current = await collection.doc(id).get();
  const existing = current.data?.[0];
  if (!existing) throw new Error("记录不存在，请刷新收件箱后重试。");
  const normalized = normalizeAdminUpdatePayload(body.payload || {});
  const payload = {
    ...normalized,
    updated_at: new Date().toISOString()
  };
  const requestedImages = Array.isArray(body.images) ? body.images : [];
  const imageOrder = Array.isArray(body.imageOrder) ? body.imageOrder : null;
  const existingImages = Array.isArray(existing.image_paths) ? existing.image_paths : [];
  let uploaded = [];
  if (requestedImages.length) {
    const uploadLimit = imageOrder
      ? IMAGE_LIMIT
      : Math.max(0, IMAGE_LIMIT - existingImages.length);
    if (!uploadLimit) throw new Error(`每条记录最多保存 ${IMAGE_LIMIT} 张图片。`);
    uploaded = await uploadImages(getApp(), id, requestedImages.slice(0, uploadLimit));
  }
  if (imageOrder || uploaded.length) {
    payload.image_paths = reconcileImagePaths(existingImages, uploaded, imageOrder);
    if (payload.image_paths.length > IMAGE_LIMIT) {
      await deleteImageFilesQuietly(getApp(), uploaded);
      throw new Error(`每条记录最多保存 ${IMAGE_LIMIT} 张图片。`);
    }
  }
  try {
    await collection.doc(id).update(payload);
  } catch (error) {
    await deleteImageFilesQuietly(getApp(), uploaded);
    throw error;
  }
  if (Object.hasOwn(payload, "image_paths")) {
    const retainedFileIDs = new Set(imageFileIDs(payload.image_paths));
    const removedExisting = existingImages.filter(image => image?.fileID && !retainedFileIDs.has(image.fileID));
    const unusedUploaded = uploaded.filter(image => image?.fileID && !retainedFileIDs.has(image.fileID));
    await deleteImageFilesQuietly(getApp(), [...removedExisting, ...unusedUploaded]);
  }
  const record = await hydrateRecordImages(getApp(), publicRecord({ ...existing, ...payload, id }));
  return { record };
}

async function adminSetProductGroup(collection, event, body) {
  const recordIds = [...new Set((Array.isArray(body.recordIds) ? body.recordIds : []).map(text).filter(Boolean))];
  if (!recordIds.length || recordIds.length > 100) throw new Error("产品归组记录数量必须在 1 到 100 条之间。");
  const snapshots = await Promise.all(recordIds.map(id => collection.doc(id).get()));
  const records = snapshots.map(result => result.data?.[0] || null);
  if (records.some(record => !record)) throw new Error("部分产品记录不存在，请刷新收件箱后重试。");
  validateProductGroupingRecords(records);
  const productGroupId = nullableText(body.productGroupId);
  const updatedAt = new Date().toISOString();
  await Promise.all(recordIds.map(id => collection.doc(id).update({
    product_group_id: productGroupId,
    updated_at: updatedAt
  })));
  const updatedSnapshots = await Promise.all(recordIds.map(id => collection.doc(id).get()));
  const updatedRecords = await Promise.all(updatedSnapshots.map((result, index) =>
    hydrateRecordImages(getApp(), publicRecord(result.data?.[0] || { id: recordIds[index], product_group_id: productGroupId, updated_at: updatedAt }))
  ));
  return { records: updatedRecords };
}

async function adminDelete(collection, event, body) {
  const id = text(body.id);
  if (!id) throw new Error("缺少记录 ID。");
  await collection.doc(id).remove();
  return { ok: true };
}

async function publishInboxState(app, kind, records, env, dependencies) {
  if (env.CATEGORYLAB_AGENTMAIL_ENABLED !== "1") return { status: "disabled" };
  try {
    return await agentmailBridge.publish(app.database(), agentmailBridge.makeEvent(kind, records), {
      env, ...(dependencies.sendAgentMail ? { send: dependencies.sendAgentMail } : {})
    });
  } catch (_) { return { status: "not_submitted", reason: "event_preparation_failed" }; }
}

async function handleEvent(event = {}, dependencies = {}) {
  if (event.httpMethod === "OPTIONS" || event.requestContext?.http?.method === "OPTIONS") {
    return jsonResponse(204, {});
  }

  try {
    const app = dependencies.app || getApp();
    const env = dependencies.env || process.env;
    const now = dependencies.now || new Date();
    if (isTimerEvent(event)) {
      if (!shouldRunScheduledScan(now)) {
        return jsonResponse(200, { ok: true, data: { scheduleSkipped: true, reason: "outside-shanghai-09", checkedAt: now.toISOString() } });
      }
      const summary = await runLaunchReminderScan(app, env, { ...dependencies, now });
      return jsonResponse(200, { ok: true, data: { scheduleSkipped: false, ...summary } });
    }

    const method = event.httpMethod || event.requestContext?.http?.method || "POST";
    const query = queryParams(event);
    if (method === "GET" && text(query.action) === "image") {
      const tempUrl = await tempUrlForFileID(app, query.fileID || query.fileId);
      return redirectResponse(tempUrl);
    }

    const body = parseEventBody(event);
    const action = text(body.action);
    if (action.startsWith("admin") && action !== "adminList") assertAdmin(event, body, env);
    if (["readPendingQuote", "savePendingQuote"].includes(action)) {
      const worker = require("./pending-quote");
      worker.assertWorker(event, env);
      const linked = action === "savePendingQuote" && env.CATEGORYLAB_AGENTMAIL_ENABLED === "1";
      const quotes = linked ? app.database().collection(COLLECTION) : null;
      const before = linked && typeof body.identity?.id === "string" ? (await quotes.doc(body.identity.id).get()).data?.[0] : null;
      const data = await worker[action === "readPendingQuote" ? "read" : "save"](app.database(), body);
      if (linked && before) {
        const after = (await quotes.doc(body.identity.id).get()).data?.[0];
        if (after && agentmailBridge.changed(before, after)) data.agentmail = await publishInboxState(app, "updated", [after], env, dependencies);
      }
      return jsonResponse(200, { ok: true, data });
    }
    const directNotificationTest = action === "sendLatestNotificationTest";
    const reminderHttpAction = REMINDER_HTTP_ACTIONS.has(action);
    const reminderDirectAction = REMINDER_DIRECT_ACTIONS.has(action);
    if (!PUBLIC_ACTIONS.has(action) && !action.startsWith("admin") && !directNotificationTest && !reminderHttpAction && !reminderDirectAction) {
      throw new Error("请求类型不支持。");
    }
    if (directNotificationTest && !isNotificationTestAuthorized(event, body, env)) {
      throw new Error("测试邮件授权失败。");
    }
    if (reminderDirectAction && !isDirectInvocation(event)) throw new Error("该提醒操作只允许腾讯云直接调用。");
    if (action === "runLaunchReminderScanFromWorker") assertReminderWorker(event, body, env);

    const collection = app.database().collection(COLLECTION);
    const watched = env.CATEGORYLAB_AGENTMAIL_ENABLED === "1" && ["adminUpdate", "adminSetProductGroup", "adminDelete"].includes(action);
    const beforeIds = watched ? (action === "adminSetProductGroup" ? [...new Set(Array.isArray(body.recordIds) ? body.recordIds : [])] : [body.id]) : [];
    const beforeRecords = watched ? (await Promise.all(beforeIds.filter(id => typeof id === "string" && id.length <= 128).slice(0,100).map(id => collection.doc(id).get()))).flatMap(result => result.data || []) : [];
    let data;

    if (action === "ping") data = { ok: true };
    else if (action === "adminSyncAgentMail") {
      const records = (await collection.orderBy("created_at", "desc").limit(1000).get()).data || [];
      if (records.length >= 1000) throw new Error("全量同步超过当前批次上限，请先分页核对，未发送。");
      data = { recordCount: records.length, agentmail: await publishInboxState(app, "snapshot", records, env, dependencies) };
    }
    else if (action === "adminAgentMailReceipt") data = { receipt: await agentmailBridge.receipt(app.database(), body.eventId) };
    else if (directNotificationTest) data = await sendLatestNotificationTest(app, collection, event, body);
    else if (action === "enableLaunchReminders") data = await enableLaunchReminders(app, event, body, env, now);
    else if (action === "syncLaunchReminders") data = await syncLaunchReminders(app, event, body, now);
    else if (action === "launchReminderStatus") data = await launchReminderStatus(app, event, body);
    else if (action === "runLaunchReminderScanFromWorker") data = await runLaunchReminderScan(app, env, { ...dependencies, now });
    else if (action === "scanLaunchReminders") data = { scheduleSkipped: false, ...(await runLaunchReminderScan(app, env, { ...dependencies, now })) };
    else if (action === "sendLaunchReminderTest") data = await sendLaunchReminderTest(app, event, body, env, { ...dependencies, now });
    else if (action === "submitSupplierFeedback") data = await submitSupplierFeedback(app, collection, body);
    else if (action === "adminLogin") {
      data = { profile: { display_name: "Louise", role: "owner" } };
    } else if (action === "adminList") data = await adminList(collection, event, body);
    else if (action === "adminUpdate") data = await adminUpdate(collection, event, body);
    else if (action === "adminSetProductGroup") data = await adminSetProductGroup(collection, event, body);
    else if (action === "adminDelete") data = await adminDelete(collection, event, body);

    if (env.CATEGORYLAB_AGENTMAIL_ENABLED === "1") {
      if (action === "submitSupplierFeedback") data.agentmail = await publishInboxState(app, "created", [data.record], env, dependencies);
      else if (action === "adminDelete" && beforeRecords.length) data.agentmail = await publishInboxState(app, "deleted", beforeRecords, env, dependencies);
      else if (watched) {
        const after = data.records || (data.record ? [data.record] : []);
        const changed = after.filter(record => {
          const before = beforeRecords.find(x => (x.id || x._id) === (record.id || record._id));
          return before && agentmailBridge.changed(before, record);
        });
        if (changed.length) data.agentmail = await publishInboxState(app, "updated", changed, env, dependencies);
      }
    }

    return jsonResponse(200, { ok: true, data });
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error.message || "请求失败。"
    });
  }
}

function startServer() {
  const port = Number(process.env.PORT || 9000);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      const query = Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
      const result = await handleEvent({
        httpMethod: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        url: req.url,
        queryStringParameters: query
      });
      res.writeHead(result.statusCode, result.headers);
      res.end(result.body || "");
    });
  });
  server.listen(port, "0.0.0.0");
}

if (require.main === module) startServer();

exports.main = handleEvent;

exports._private = {
  handleEvent,
  makeFollowupCode,
  parseEventBody,
  normalizeRecordPayload,
  normalizeAdminUpdatePayload,
  mergeImagePaths,
  reconcileImagePaths,
  validateProductGroupingRecords,
  requireFields,
  databaseWriteRecord,
  sanitizePublicSubmissionPayload,
  publicSubmissionRecord,
  notificationConfig,
  launchReminderConfig,
  isDirectInvocation,
  isTimerEvent,
  isNotificationTestAuthorized,
  enableLaunchReminders,
  syncLaunchReminders,
  launchReminderStatus,
  assertReminderWorker,
  runLaunchReminderScan,
  sendLaunchReminderTest,
  downloadNotificationAttachments,
  notifyRecord,
  isPublicAction: action => PUBLIC_ACTIONS.has(action)
};
