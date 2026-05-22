import { supabase } from "../lib/supabaseClient";

// ==========================================
// NOTIFICATION TYPE DEFINITIONS
// ==========================================
export const NOTIFICATION_TYPES = {
    // Immediate triggers
    ORDER_PLACED: "order_placed",               // #13
    ORDER_ON_HOLD: "order_on_hold",             // #20
    ORDER_CANCELLED: "order_cancelled",         // #21
    QC_REWORK: "qc_rework",                     // #18
    ALTERATION_CREATED: "alteration_created",   // #19
    REJOURNEY_ALERT: "rejourney_alert",         // SA alert when their order's component goes to re-journey

    // Scheduled triggers (created by cron)
    ORDER_DELAYED_T1: "order_delayed_t1",       // #14
    DELIVERY_DUE_T2: "delivery_due_t2",         // #15
    DELIVERY_DUE_TODAY: "delivery_due_today",   // #17
    DELAY_1_DAY: "delay_1_day",                 // #22
    DELAY_2_DAY: "delay_2_day",                 // #23

    // Future
    PRODUCTION_STAGE_DELAY: "production_stage_delay", // #16 (hold)

    // After PRODUCTION_STAGE_DELAY line:
    SA_BIRTHDAY_REMINDER: "sa_birthday_reminder",
    SA_DELIVERY_TODAY: "sa_delivery_today",
    SA_DELIVERY_T2: "sa_delivery_t2",
    SA_DELAYED_ORDER: "sa_delayed_order",
    SA_ALTERATION_DELIVERY: "sa_alteration_delivery",

    // B2B immediate alerts
    B2B_ORDER_REJECTED: "b2b_order_rejected",
    B2B_APPROVAL_AWAITED: "b2b_approval_awaited",
    // B2B scheduled (handled by edge function, types here for reference)
    B2B_DELIVERY_TODAY: "b2b_delivery_today",
    B2B_DELIVERY_T2: "b2b_delivery_t2",
    B2B_DELAYED_ORDER: "b2b_delayed_order",

    // EXB scheduled (handled by edge function)
    EXB_BIRTHDAY_REMINDER: "exb_birthday_reminder",
    EXB_DELIVERY_TODAY: "exb_delivery_today",
    EXB_DELIVERY_T2: "exb_delivery_t2",
    EXB_DELAYED_ORDER: "exb_delayed_order",
    EXB_ALTERATION_DELIVERY: "exb_alteration_delivery",

    // Management alerts
    ORDER_REVOKED: "order_revoked",
    ORDER_REVOKED_WAREHOUSE: "order_revoked_warehouse",

    // Comms approval workflow (>Rs 35,000 Gifting/Barter orders need Jahnavi sign-off)
    COMMS_APPROVAL_AWAITED: "comms_approval_awaited",   // to admin (Jahnavi)
    COMMS_ORDER_APPROVED: "comms_order_approved",       // back to comms team (Nazreen)
    COMMS_ORDER_REJECTED: "comms_order_rejected",       // back to comms team (Nazreen)

    // Comms sourcing return reminders (fired by a scheduled edge function)
    COMMS_RETURN_DUE_TOMORROW: "comms_return_due_tomorrow",   // 24h before outfit_return_date
    COMMS_RETURN_OVERDUE: "comms_return_overdue",             // 24h after outfit_return_date with no return
};

// ==========================================
// RECIPIENT MAPPING PER NOTIFICATION TYPE
// Matches against salesperson.designation via ILIKE
// ==========================================
const RECIPIENT_MAP = {
    [NOTIFICATION_TYPES.ORDER_PLACED]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_DELAYED_T1]: [
        { designation: "Sales Manager", channel: "in_app" },
        // + the specific sales associate (added dynamically via extraRecipients)
    ],
    [NOTIFICATION_TYPES.DELIVERY_DUE_T2]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.DELIVERY_DUE_TODAY]: [
        { designation: "Production Manager", channel: "both" },
        { designation: "Offline Production Head", channel: "both" },
        { designation: "Offline Production Assistant", channel: "both" },
    ],
    [NOTIFICATION_TYPES.REJOURNEY_ALERT]: [
        { designation: "Offline Production Head", channel: "in_app" },
        // + SA who placed the order (added dynamically via extraRecipients)
    ],
    [NOTIFICATION_TYPES.QC_REWORK]: [
        { designation: "Production Manager", channel: "in_app" },
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ALTERATION_CREATED]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_ON_HOLD]: [
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_CANCELLED]: [
        { designation: "Production Manager", channel: "in_app" },
        { designation: "Offline Production Head", channel: "in_app" },
        { designation: "Offline Production Assistant", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.DELAY_1_DAY]: [
        { designation: "Production Manager", channel: "both" },
    ],
    [NOTIFICATION_TYPES.DELAY_2_DAY]: [
        { designation: "Production Manager", channel: "both" },
        { role: "escalation_contact", channel: "both" },
    ],
    [NOTIFICATION_TYPES.PRODUCTION_STAGE_DELAY]: [
        // Future — hold for now
    ],
    [NOTIFICATION_TYPES.B2B_ORDER_REJECTED]: [
        { role: "executive", store: "B2B", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.B2B_APPROVAL_AWAITED]: [
        { role: "executive", store: "B2B", channel: "in_app" },
        { role: "merchandiser", store: "B2B", channel: "in_app" },
    ],
    [NOTIFICATION_TYPES.ORDER_REVOKED]: [
        { role: "admin", channel: "in_app" },   // Jahnavi (CMO)
        { role: "coo", channel: "in_app" },      // Manish (COO)
    ],
    [NOTIFICATION_TYPES.ORDER_REVOKED_WAREHOUSE]: [
        { designation: "Production Manager", channel: "both" },
        { designation: "Offline Production Head", channel: "both" },
        { role: "admin", channel: "both" },    // Jahnavi
        { role: "coo", channel: "both" },       // Manish
    ],

    // Comms approval workflow
    [NOTIFICATION_TYPES.COMMS_APPROVAL_AWAITED]: [
        { role: "admin", channel: "in_app" },   // Jahnavi gets the approval ask
    ],
    [NOTIFICATION_TYPES.COMMS_ORDER_APPROVED]: [
        { role: "comms", channel: "in_app" },   // Nazreen learns her order was approved
    ],
    [NOTIFICATION_TYPES.COMMS_ORDER_REJECTED]: [
        { role: "comms", channel: "in_app" },   // Nazreen learns her order was rejected
    ],
    [NOTIFICATION_TYPES.COMMS_RETURN_DUE_TOMORROW]: [
        { role: "comms", channel: "in_app" },   // Nazreen: outfit return is due tomorrow
    ],
    [NOTIFICATION_TYPES.COMMS_RETURN_OVERDUE]: [
        { role: "comms", channel: "in_app" },   // Nazreen: outfit return is overdue
        { role: "admin", channel: "in_app" },   // Jahnavi gets escalation visibility
    ],
};

// ==========================================
// NOTIFICATION TITLE & MESSAGE TEMPLATES
// ==========================================
const TEMPLATES = {
    [NOTIFICATION_TYPES.ORDER_PLACED]: (meta) => {
        // Stock orders bypass the customer flow entirely (no real client),
        // so the trailing "client" suffix doesn't apply. Detect via the
        // order_no prefix so we don't need every caller to pass a flag.
        const isStock = typeof meta.order_no === "string" && meta.order_no.includes("-STOCK-");
        const trailer = isStock ? "" : " client";
        return {
            title: "New Order Placed",
            message: `Order ${meta.order_no}${meta.is_urgent ? " 🔥 URGENT" : ""} — ${meta.store || meta.source || "Offline"}${trailer}`,
            priority: meta.is_urgent ? "urgent" : "normal",
        };
    },
    [NOTIFICATION_TYPES.ORDER_DELAYED_T1]: (meta) => ({
        title: "Order Delayed",
        message: `Order Delayed — ${meta.client_name} (${meta.order_no})`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.DELIVERY_DUE_T2]: (meta) => ({
        title: "Delivery Due Soon",
        message: `Upcoming Delivery — ${meta.order_no} due in 2 days`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.DELIVERY_DUE_TODAY]: (meta) => ({
        title: "Delivery Due Today",
        message: `Delivery Due Today — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.REJOURNEY_ALERT]: (meta) => ({
        title: "QC Failed — Re-journey",
        message: `${meta.component_label || "Component"} (${meta.barcode}) sent back to ${meta.rejourney_stage || "earlier stage"} — Order ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.QC_REWORK]: (meta) => ({
        title: "QC Issue — Rework Required",
        message: `Rework post client delivery — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.ALTERATION_CREATED]: (meta) => ({
        title: "Alteration Required",
        message: `Alteration Required — ${meta.order_no}`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.ORDER_ON_HOLD]: (meta) => ({
        title: "Order On Hold",
        message: `Order On Hold — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.ORDER_CANCELLED]: (meta) => ({
        title: "Order Cancelled",
        message: `Cancelled — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.DELAY_1_DAY]: (meta) => ({
        title: "1-Day Delay Alert",
        message: `1 day order delayed – Immediate Follow-Up Needed (${meta.order_no})`,
        priority: "escalation",
    }),
    [NOTIFICATION_TYPES.DELAY_2_DAY]: (meta) => ({
        title: "2-Day Delay Alert",
        message: `2 days order delayed – Immediate Follow-Up Needed (${meta.order_no})`,
        priority: "escalation",
    }),
    [NOTIFICATION_TYPES.B2B_ORDER_REJECTED]: (meta) => ({
        title: "B2B Order Rejected",
        message: `Rejected Order — ${meta.order_no}`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.B2B_APPROVAL_AWAITED]: (meta) => ({
        title: "Approval Awaited",
        message: `Approval Awaited — ${meta.order_no}`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.ORDER_REVOKED]: (meta) => ({
        title: "Order Revoked",
        message: `Delivery Revoked — ${meta.order_no} — ${meta.client_name || "Client"} — ${meta.reason || "No reason"} — SA: ${meta.sa_name || "N/A"}`,
        priority: "escalation",
    }),
    [NOTIFICATION_TYPES.ORDER_REVOKED_WAREHOUSE]: (meta) => ({
        title: "Order Revoked",
        message: `Revoked Order — ${meta.order_no}`,
        priority: "escalation",
    }),

    // Comms approval workflow templates
    [NOTIFICATION_TYPES.COMMS_APPROVAL_AWAITED]: (meta) => ({
        title: "Comms Approval Needed",
        message: `Comms order ${meta.order_no} (${meta.engagement_type || "Comms"}) for ${meta.client_name || "Client"} — value ₹${meta.value || 0} — awaiting your approval.`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.COMMS_ORDER_APPROVED]: (meta) => ({
        title: "Comms Order Approved",
        message: `Order ${meta.order_no} approved by ${meta.approved_by || "admin"}.`,
        priority: "normal",
    }),
    [NOTIFICATION_TYPES.COMMS_ORDER_REJECTED]: (meta) => ({
        title: "Comms Order Rejected",
        message: `Order ${meta.order_no} rejected${meta.reason ? ` — ${meta.reason}` : ""}.`,
        priority: "urgent",
    }),

    // Sourcing return reminders (fired by scheduled edge function)
    [NOTIFICATION_TYPES.COMMS_RETURN_DUE_TOMORROW]: (meta) => ({
        title: "Outfit Return Due Tomorrow",
        message: `Order ${meta.order_no} (${meta.client_name || "—"}) — outfit return is due on ${meta.return_date}.`,
        priority: "urgent",
    }),
    [NOTIFICATION_TYPES.COMMS_RETURN_OVERDUE]: (meta) => ({
        title: "Outfit Return Overdue",
        message: `Order ${meta.order_no} (${meta.client_name || "—"}) — outfit return was due ${meta.return_date} and has not been returned.`,
        priority: "escalation",
    }),

};

// ==========================================
// CORE: Send Notification
// ==========================================
/**
 * Send a notification to the appropriate recipients
 *
 * @param {string} type - NOTIFICATION_TYPES value
 * @param {object} options
 * @param {string} options.orderId - order UUID
 * @param {string} options.orderNo - order number for display
 * @param {object} options.metadata - extra data (client_name, source, is_urgent, stage_name, etc.)
 * @param {Array}  options.attachments - [{ type: 'order_pdf', url: '...' }]
 * @param {Array}  options.extraRecipients - additional [{ email, designation, channel }]
 */
export const sendNotification = async (type, options = {}) => {
    try {
        const {
            orderId = null,
            orderNo = "",
            metadata = {},
            attachments = [],
            extraRecipients = [],
        } = options;

        // 1. Generate title, message, priority from template
        const template = TEMPLATES[type];
        if (!template) {
            console.error(`❌ Unknown notification type: ${type}`);
            return null;
        }

        const { title, message, priority } = template({ ...metadata, order_no: orderNo });

        // 2. Insert notification
        const { data: notification, error: notifError } = await supabase
            .from("notifications")
            .insert({
                type,
                title,
                message,
                order_id: orderId,
                order_no: orderNo,
                priority,
                attachments,
                metadata,
                sent: true,
                sent_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (notifError) {
            console.error("❌ Notification insert error:", notifError);
            return null;
        }

        // 3. Resolve recipients
        const recipientConfigs = [
            ...(RECIPIENT_MAP[type] || []),
            ...extraRecipients,
        ];

        const recipients = [];

        for (const config of recipientConfigs) {
            if (config.role === "escalation_contact") {
                // Fetch escalation contacts from settings
                const { data: setting } = await supabase
                    .from("notification_settings")
                    .select("value")
                    .eq("key", "escalation_contacts")
                    .single();

                const emails = setting?.value || [];
                for (const email of emails) {
                    recipients.push({
                        notification_id: notification.id,
                        recipient_role: "escalation_contact",
                        recipient_email: email,
                        recipient_designation: null,
                        channel: config.channel || "both",
                    });
                }
            } else if (config.email) {
                // Specific email recipient (e.g. the salesperson on the order)
                recipients.push({
                    notification_id: notification.id,
                    recipient_role: config.role || null,
                    recipient_email: config.email,
                    recipient_designation: config.designation || null,
                    channel: config.channel || "in_app",
                });
            } else if (config.role && config.store) {
                // Role + store-based: find all users with this role in this store
                const { data: users } = await supabase
                    .from("salesperson")
                    .select("email, role")
                    .eq("role", config.role)
                    .eq("store_name", config.store);

                if (users) {
                    for (const user of users) {
                        recipients.push({
                            notification_id: notification.id,
                            recipient_role: config.role,
                            recipient_email: user.email,
                            recipient_designation: null,
                            channel: config.channel || "in_app",
                        });
                    }
                }
            } else if (config.role) {
                // Role-only (management roles like admin, coo)
                const { data: roleUsers } = await supabase
                    .from("salesperson")
                    .select("email, role")
                    .eq("role", config.role);

                if (roleUsers) {
                    for (const ru of roleUsers) {
                        recipients.push({
                            notification_id: notification.id,
                            recipient_role: config.role,
                            recipient_email: ru.email,
                            recipient_designation: null,
                            channel: config.channel || "in_app",
                        });
                    }
                }
            } else if (config.designation) {
                // Designation-based: find all users with this designation
                const { data: users } = await supabase
                    .from("salesperson")
                    .select("email, designation")
                    .ilike("designation", `%${config.designation}%`);

                if (users) {
                    for (const user of users) {
                        recipients.push({
                            notification_id: notification.id,
                            recipient_role: config.designation.toLowerCase().replace(/\s+/g, "_"),
                            recipient_email: user.email,
                            recipient_designation: user.designation,
                            channel: config.channel || "in_app",
                        });
                    }
                }
            }
        }

        // 4. Insert all recipients (dedup by email)
        const uniqueRecipients = [];
        const seen = new Set();
        for (const r of recipients) {
            const key = `${r.notification_id}_${r.recipient_email}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRecipients.push(r);
            }
        }

        if (uniqueRecipients.length > 0) {
            const { error: recipError } = await supabase
                .from("notification_recipients")
                .insert(uniqueRecipients);

            if (recipError) {
                console.error("❌ Recipients insert error:", recipError);
            }
        }

        return notification;

    } catch (err) {
        console.error("❌ sendNotification error:", err);
        return null;
    }
};

// ==========================================
// FETCH: Get notifications for current user
// ==========================================
export const getNotifications = async (email, options = {}) => {
    const { unreadOnly = false, limit = 50 } = options;

    let query = supabase
        .from("notification_recipients")
        .select(`
      id,
      read,
      read_at,
      channel,
      created_at,
      notification:notification_id (
        id,
        type,
        title,
        message,
        order_id,
        order_no,
        priority,
        attachments,
        metadata,
        created_at
      )
    `)
        .eq("recipient_email", email)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (unreadOnly) {
        query = query.eq("read", false);
    }

    const { data, error } = await query;

    if (error) {
        console.error("❌ getNotifications error:", error);
        return [];
    }

    return data || [];
};

// ==========================================
// MARK AS READ
// ==========================================
export const markAsRead = async (recipientId) => {
    const { error } = await supabase
        .from("notification_recipients")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("id", recipientId);

    if (error) console.error("❌ markAsRead error:", error);
};

export const markAllAsRead = async (email) => {
    const { error } = await supabase
        .from("notification_recipients")
        .update({ read: true, read_at: new Date().toISOString() })
        .eq("recipient_email", email)
        .eq("read", false);

    if (error) console.error("❌ markAllAsRead error:", error);
};

// ==========================================
// GET UNREAD COUNT
// ==========================================
export const getUnreadCount = async (email) => {
    const { count, error } = await supabase
        .from("notification_recipients")
        .select("id", { count: "exact", head: true })
        .eq("recipient_email", email)
        .eq("read", false);

    if (error) {
        console.error("❌ getUnreadCount error:", error);
        return 0;
    }

    return count || 0;
};


// ==========================================
// CLEAR ALL NOTIFICATIONS
// ==========================================
export const clearAllNotifications = async (email) => {
    const { error } = await supabase
        .from("notification_recipients")
        .delete()
        .eq("recipient_email", email);

    if (error) console.error("❌ clearAllNotifications error:", error);
};