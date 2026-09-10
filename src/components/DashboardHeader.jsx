import React from "react";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import NotificationBell from "./NotificationBell";
import "./DashboardHeader.css";

/**
 * DASHBOARD HEADER — the one header for every role dashboard.
 *
 * WHY THIS EXISTS: the app had 23 dashboards with 23 hand-rolled <header>
 * blocks across 18 CSS namespaces (prod-header, merch-header, wd-top-header,
 * admin-header shared by four screens, …). Nothing kept them in step, so they
 * drifted apart in ways users noticed:
 *
 *   - Logout was MISSING from 5 headers (B2B Production, Comms, Scan Station,
 *     Shopify Orders, Warehouse) — each had a working handler, just no button.
 *   - The NotificationBell was on 14 of 23.
 *   - Clicking the LOGO LOGGED YOU OUT on 4 dashboards (Associate, B2B
 *     Executive, Assistant CMO, CEO Assistant) while doing nothing on 9 and
 *     going home on 3. Signing a user out with no confirmation because they
 *     clicked the brand mark is the bug this component ends.
 *   - Logout was text on 14 screens and a bare unlabelled SVG on 3.
 *
 * THE SHAPE, fixed for every dashboard:
 *
 *     [hamburger] [logo]        TITLE        [actions] [bell] [user] [logout]
 *
 * Layout is a 3-column grid, NOT flex with a stretching centre: the title is
 * centred against the PAGE, so it does not shift when the right side gains a
 * button or a long user name. The old flex+`flex:1` title drifted off-centre
 * on exactly those screens.
 *
 * WHAT IS DELIBERATELY STILL PER-SCREEN (pass as props, do not hardcode):
 *   title      Scan Station retitles per tab; Store Manager is "<Store> Store
 *              Manager". A dynamic title is real, not drift.
 *   actions    Shopify Orders has "Sync now". Screen-specific header buttons
 *              go here, left of the bell.
 *   userName   5 dashboards show who is logged in.
 *
 * ONE NAMESPACE: every class is `dh-*`. Do not re-add per-screen header CSS.
 */
export default function DashboardHeader({
  title,
  onHome,          // logo/title click → that dashboard's home tab. Never logout.
  onMenuToggle,    // omit to hide the hamburger (Accounts and Walk-In have no sidebar)
  userEmail,       // NotificationBell's subscriber. Omit to hide the bell.
  onOrderClick,
  userName,
  actions,         // screen-specific header controls (e.g. "Sync now")
  onLogout,        // omit for the DEFAULT logout, which is what almost every screen wants
  showLogout = true,
}) {
  // Default logout. Most screens duplicated exactly this; a screen needing
  // more (clearing an order-mode flag, restoring an associate session) passes
  // its own onLogout and that wins.
  const handleLogout = async () => {
    if (onLogout) return onLogout();
    await supabase.auth.signOut();
    window.location.assign("/login");
  };

  return (
    <header className="dh-header">
      <div className="dh-left">
        {onMenuToggle && (
          <button className="dh-hamburger" onClick={onMenuToggle} aria-label="Toggle menu" type="button">
            <span /><span /><span />
          </button>
        )}
        {/* The logo goes HOME, never logs out. A <button> not an <img onClick>
            so it is keyboard-reachable and announces itself; when a screen has
            no home tab to go to it renders as a plain image instead. */}
        {onHome ? (
          <button className="dh-logo-btn" onClick={onHome} aria-label="Go to dashboard home" type="button">
            <img src={Logo} alt="Sheetal Batra" className="dh-logo" />
          </button>
        ) : (
          <img src={Logo} alt="Sheetal Batra" className="dh-logo" />
        )}
      </div>

      <h1 className="dh-title">{title}</h1>

      <div className="dh-right">
        {actions}
        {userEmail && <NotificationBell userEmail={userEmail} onOrderClick={onOrderClick} />}
        {userName && <span className="dh-user">{userName}</span>}
        {showLogout && (
          <button className="dh-logout" onClick={handleLogout} type="button">Logout</button>
        )}
      </div>
    </header>
  );
}
