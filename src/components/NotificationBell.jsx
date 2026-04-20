import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    clearAllNotifications,
} from "../utils/notificationService";
import "./NotificationBell.css";

// Priority badge colors
const PRIORITY_COLORS = {
    normal: "#2196f3",
    urgent: "#ff9800",
    escalation: "#f44336",
};

// Time ago helper
const timeAgo = (dateStr) => {
    if (!dateStr) return "";
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

// Notification type icons
const TYPE_ICONS = {
    order_placed: "📦",
    order_delayed_t1: "⏰",
    delivery_due_t2: "📅",
    delivery_due_today: "🚚",
    qc_rework: "🔧",
    alteration_created: "✂️",
    order_on_hold: "⏸️",
    order_cancelled: "❌",
    delay_1_day: "⚠️",
    delay_2_day: "🚨",
    production_stage_delay: "🏭",
};

/**
 * NotificationBell — Reusable notification bell with slide-out drawer
 *
 * @param {string} userEmail - Current user's email (for filtering)
 * @param {function} onOrderClick - Optional callback when user clicks an order notification
 */
const NotificationBell = ({ userEmail, onOrderClick }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState("all"); // 'all' | 'unread'
    const drawerRef = useRef(null);

    // Fetch notifications
    const fetchNotifications = useCallback(async () => {
        if (!userEmail) return;
        setLoading(true);
        try {
            const data = await getNotifications(userEmail, {
                unreadOnly: activeFilter === "unread",
                limit: 50,
            });
            setNotifications(data);
            const count = await getUnreadCount(userEmail);
            setUnreadCount(count);
        } catch (err) {
            console.error("Notification fetch error:", err);
        } finally {
            setLoading(false);
        }
    }, [userEmail, activeFilter]);

    // Initial load
    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // Realtime subscription
    useEffect(() => {
        if (!userEmail) return;

        const channel = supabase
            .channel("notifications-realtime")
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "notification_recipients",
                    filter: `recipient_email=eq.${userEmail}`,
                },
                (payload) => {
                    fetchNotifications();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userEmail, fetchNotifications]);

    // Close drawer on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (
                drawerRef.current &&
                !drawerRef.current.contains(e.target) &&
                !e.target.closest(".notif-bell-btn")
            ) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isOpen]);

    // Handle mark single as read
    const handleMarkRead = async (recipientId) => {
        await markAsRead(recipientId);
        setNotifications((prev) =>
            prev.map((n) =>
                n.id === recipientId
                    ? { ...n, read: true, read_at: new Date().toISOString() }
                    : n
            )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
    };

    // Handle mark all as read
    const handleMarkAllRead = async () => {
        await markAllAsRead(userEmail);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
    };

    // Handle clear all
    const handleClearAll = async () => {
        await clearAllNotifications(userEmail);
        setNotifications([]);
        setUnreadCount(0);
    };

    // Handle notification click
    const handleNotifClick = (notif) => {
        if (!notif.read) {
            handleMarkRead(notif.id);
        }
        if (onOrderClick && notif.notification?.order_id) {
            onOrderClick(notif.notification.order_id, notif.notification.order_no);
            setIsOpen(false);
        }
    };

    return (
        <>
            {/* Bell Button */}
            <button
                className="notif-bell-btn"
                onClick={() => setIsOpen(!isOpen)}
                title="Notifications"
            >
                <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unreadCount > 0 && (
                    <span className="notif-bell-badge">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </button>

            {/* Portal: Overlay + Drawer rendered at body level to escape stacking context */}
            {createPortal(
                <>
                    {isOpen && (
                        <div className="notif-overlay" onClick={() => setIsOpen(false)} />
                    )}
                    <div
                        ref={drawerRef}
                        className={`notif-drawer ${isOpen ? "notif-drawer-open" : ""}`}
                    >
                        {/* Drawer Header */}
                        <div className="notif-drawer-header">
                            <h3>Notifications</h3>
                            <div className="notif-drawer-actions">
                                {unreadCount > 0 && (
                                    <button className="notif-mark-all" onClick={handleMarkAllRead}>
                                        Mark all read
                                    </button>
                                )}
                                {notifications.length > 0 && (
                                    <button className="notif-mark-all" onClick={handleClearAll} style={{ color: '#f44336' }}>
                                        Clear all
                                    </button>
                                )}
                                <button
                                    className="notif-close-btn"
                                    onClick={() => setIsOpen(false)}
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Filter Tabs */}
                        <div className="notif-filter-tabs">
                            <button
                                className={`notif-filter-tab ${activeFilter === "all" ? "active" : ""}`}
                                onClick={() => setActiveFilter("all")}
                            >
                                All
                            </button>
                            <button
                                className={`notif-filter-tab ${activeFilter === "unread" ? "active" : ""}`}
                                onClick={() => setActiveFilter("unread")}
                            >
                                Unread ({unreadCount})
                            </button>
                        </div>

                        {/* Notification List */}
                        <div className="notif-list">
                            {loading ? (
                                <div className="notif-loading">Loading...</div>
                            ) : notifications.length === 0 ? (
                                <div className="notif-empty">
                                    <span className="notif-empty-icon">🔔</span>
                                    <p>
                                        {activeFilter === "unread"
                                            ? "No unread notifications"
                                            : "No notifications yet"}
                                    </p>
                                </div>
                            ) : (
                                notifications.map((notif) => {
                                    const n = notif.notification;
                                    if (!n) return null;
                                    const icon = TYPE_ICONS[n.type] || "📌";
                                    const priorityColor =
                                        PRIORITY_COLORS[n.priority] || PRIORITY_COLORS.normal;

                                    return (
                                        <div
                                            key={notif.id}
                                            className={`notif-item ${!notif.read ? "notif-unread" : ""}`}
                                            onClick={() => handleNotifClick(notif)}
                                        >
                                            <div className="notif-item-left">
                                                <span className="notif-icon">{icon}</span>
                                                <div
                                                    className="notif-priority-dot"
                                                    style={{ backgroundColor: priorityColor }}
                                                />
                                            </div>
                                            <div className="notif-item-content">
                                                <div className="notif-item-title">{n.title}</div>
                                                <div className="notif-item-message">{n.message}</div>
                                                {n.attachments?.length > 0 && (
                                                    <div className="notif-attachments">
                                                        {n.attachments.map((att, i) => (
                                                            <a
                                                                key={i}
                                                                href={att.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="notif-attachment-link"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                📎{" "}
                                                                {att.type === "order_pdf"
                                                                    ? "Order PDF"
                                                                    : att.type === "rework_pdf"
                                                                        ? "Rework PDF"
                                                                        : att.type === "alteration_pdf"
                                                                            ? "Alteration PDF"
                                                                            : "Attachment"}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                                <div className="notif-item-time">{timeAgo(n.created_at)}</div>
                                            </div>
                                            {!notif.read && <div className="notif-unread-dot" />}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>,
                document.body
            )}
        </>
    );
};

export default NotificationBell;