import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatDate from "../../utils/formatDate";

const EVENT_TYPES = [
  { value: "follow_up", label: "Follow-up", color: "#1976d2" },
  { value: "event", label: "Event", color: "#2e7d32" },
  { value: "shoot", label: "Shoot", color: "#ef6c00" },
  { value: "custom", label: "Custom", color: "#7b1fa2" },
];

const eventTypeMeta = (value) =>
  EVENT_TYPES.find((t) => t.value === value) || { label: value, color: "#888" };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const isoFromYMD = (year, month, date) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

export default function CommsCalendar({ profile, orders, showPopup }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  // Month-grid navigation state
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // Modal state
  const [modal, setModal] = useState(null); // { mode: "create" | "edit", event? }
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(todayISO());
  const [eventType, setEventType] = useState("follow_up");
  const [relatedOrderId, setRelatedOrderId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.email) { setLoading(false); return; }
      const { data } = await supabase
        .from("comms_calendar_events")
        .select("*")
        .eq("user_email", profile.email.toLowerCase())
        .order("event_date", { ascending: true });
      if (cancelled) return;
      setEvents(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [profile?.email]);

  // Index events by YYYY-MM-DD for quick day-cell lookup
  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach((e) => {
      (map[e.event_date] ||= []).push(e);
    });
    return map;
  }, [events]);

  const eventsForSelected = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  const openCreate = () => {
    setTitle("");
    setDescription("");
    setEventDate(selectedDate || todayISO());
    setEventType("follow_up");
    setRelatedOrderId("");
    setModal({ mode: "create" });
  };

  const openEdit = (event) => {
    setTitle(event.title || "");
    setDescription(event.description || "");
    setEventDate(event.event_date || todayISO());
    setEventType(event.event_type || "follow_up");
    setRelatedOrderId(event.related_order_id || "");
    setModal({ mode: "edit", event });
  };

  const closeModal = () => { if (!saving) setModal(null); };

  const handleSave = async () => {
    if (!title.trim()) {
      showPopup({ title: "Required", message: "Please add a title.", type: "warning" });
      return;
    }
    if (!eventDate) {
      showPopup({ title: "Required", message: "Please pick a date.", type: "warning" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_email: profile.email.toLowerCase(),
        title: title.trim(),
        description: description.trim() || null,
        event_date: eventDate,
        event_type: eventType,
        related_order_id: relatedOrderId || null,
      };

      if (modal.mode === "create") {
        const { data, error } = await supabase
          .from("comms_calendar_events")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        setEvents((prev) => [...prev, data].sort((a, b) => a.event_date.localeCompare(b.event_date)));
        setSelectedDate(eventDate);
      } else {
        const { data, error } = await supabase
          .from("comms_calendar_events")
          .update(payload)
          .eq("id", modal.event.id)
          .select()
          .single();
        if (error) throw error;
        setEvents((prev) => prev.map((e) => e.id === data.id ? data : e));
      }
      setModal(null);
    } catch (err) {
      console.error("Save event failed:", err);
      showPopup({ title: "Failed", message: err.message || "Could not save event.", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event) => {
    showPopup({
      title: "Delete event?",
      message: `Remove "${event.title}" from your calendar?`,
      type: "confirm",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        try {
          const { error } = await supabase
            .from("comms_calendar_events")
            .delete()
            .eq("id", event.id);
          if (error) throw error;
          setEvents((prev) => prev.filter((e) => e.id !== event.id));
        } catch (err) {
          console.error("Delete event failed:", err);
          showPopup({ title: "Failed", message: err.message || "Could not delete event.", type: "error" });
        }
      },
    });
  };

  if (loading) {
    return <div className="comms-card"><p className="comms-muted">Loading calendar…</p></div>;
  }

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const today = todayISO();

  return (
    <>
      <div className="comms-card">
        <div className="comms-overview-header" style={{ marginBottom: 14 }}>
          <h3 className="comms-card-title" style={{ margin: 0 }}></h3>
          <button className="comms-primary-btn" onClick={openCreate}>+ New Event</button>
        </div>

        <div className="comms-cal-month">
          <div className="comms-cal-month-header">
            <button
              className="comms-cal-nav-btn"
              onClick={() => setCalendarDate(new Date(year, month - 1, 1))}
            >‹</button>
            <span className="comms-cal-month-label">
              {calendarDate.toLocaleString("default", { month: "long", year: "numeric" })}
            </span>
            <button
              className="comms-cal-nav-btn"
              onClick={() => setCalendarDate(new Date(year, month + 1, 1))}
            >›</button>
          </div>

          <div className="comms-cal-weekrow">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="comms-cal-weekday">{d}</div>
            ))}
          </div>

          <div className="comms-cal-grid">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dateNum = i - firstDayOfMonth + 1;
              if (dateNum <= 0 || dateNum > daysInMonth) {
                return <div key={i} className="comms-cal-cell comms-cal-empty" />;
              }
              const iso = isoFromYMD(year, month, dateNum);
              const dayEvents = eventsByDate[iso] || [];
              const isToday = iso === today;
              const isSelected = iso === selectedDate;
              const dotTypes = [...new Set(dayEvents.map((e) => e.event_type))];

              return (
                <div
                  key={i}
                  className={`comms-cal-cell ${isToday ? "comms-cal-today" : ""} ${isSelected ? "comms-cal-selected" : ""} ${dayEvents.length > 0 ? "comms-cal-has-events" : ""}`}
                  onClick={() => setSelectedDate(iso)}
                >
                  <span className="comms-cal-cell-num">{dateNum}</span>
                  {dayEvents.length > 0 && (
                    <span className="comms-cal-cell-count">{dayEvents.length}</span>
                  )}
                  {dotTypes.length > 0 && (
                    <div className="comms-cal-cell-dots">
                      {dotTypes.slice(0, 4).map((t) => (
                        <span key={t} className="comms-cal-cell-dot" style={{ background: eventTypeMeta(t).color }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedDate && (
        <div className="comms-card">
          <div className="comms-overview-header" style={{ marginBottom: 14 }}>
            <h3 className="comms-card-title" style={{ margin: 0 }}>
              {formatDate(selectedDate)}{selectedDate === today && <span className="comms-cal-today-pill" style={{ marginLeft: 8 }}>Today</span>}
            </h3>
            <span className="comms-muted" style={{ fontSize: 12 }}>
              {eventsForSelected.length} event{eventsForSelected.length === 1 ? "" : "s"}
            </span>
          </div>

          {eventsForSelected.length === 0 ? (
            <p className="comms-muted">
              No events on this day. Click <b>+ New Event</b> to add one.
            </p>
          ) : (
            <div className="comms-cal-list">
              {eventsForSelected.map((e) => {
                const meta = eventTypeMeta(e.event_type);
                const order = e.related_order_id ? orders.find((o) => o.id === e.related_order_id) : null;
                return (
                  <div key={e.id} className="comms-cal-item">
                    <span className="comms-cal-type-dot" style={{ background: meta.color }} />
                    <div className="comms-cal-item-body">
                      <div className="comms-cal-item-title">{e.title}</div>
                      {e.description && <div className="comms-cal-item-desc">{e.description}</div>}
                      <div className="comms-cal-item-meta">
                        <span className="comms-cal-type-label" style={{ color: meta.color }}>{meta.label}</span>
                        {order && (
                          <span style={{ marginLeft: 10, fontSize: 12, color: "#888" }}>· Order {order.order_no}</span>
                        )}
                      </div>
                    </div>
                    <div className="comms-cal-item-actions">
                      <button className="comms-cal-action-btn" onClick={() => openEdit(e)}>Edit</button>
                      <button className="comms-cal-action-btn comms-cal-delete" onClick={() => handleDelete(e)}>Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {modal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              width: "92%", maxWidth: 500,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#d5b85a" }}>
              {modal.mode === "create" ? "New Event" : "Edit Event"}
            </h3>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                Title <span style={{ color: "#c62828" }}>*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Follow up with Vanda on Diwali shoot"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                  Date <span style={{ color: "#c62828" }}>*</span>
                </label>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                >
                  {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                Description / Notes
              </label>
              <textarea
                rows={3}
                placeholder="Optional details…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
              />
            </div>

            {orders.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                  Link to Order (optional)
                </label>
                <select
                  value={relatedOrderId}
                  onChange={(e) => setRelatedOrderId(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
                >
                  <option value="">— None —</option>
                  {orders.slice(0, 50).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_no} · {o.delivery_name || "—"} · {o.comms_engagement_type || ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button
                disabled={saving}
                onClick={closeModal}
                style={{ padding: "8px 16px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
              >Cancel</button>
              <button
                disabled={saving}
                onClick={handleSave}
                style={{
                  padding: "8px 16px", border: "none", borderRadius: 6,
                  background: "#d5b85a", color: "#fff",
                  cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                  opacity: saving ? 0.6 : 1,
                }}
              >{saving ? "Saving…" : (modal.mode === "create" ? "Create" : "Save")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
