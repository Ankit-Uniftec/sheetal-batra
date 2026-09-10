// Renders the shared Delivery Performance panel with realistic rows, so a
// crash or a mis-wired metric shows up here rather than on the dispatch desk.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DeliveryPerformancePanel from "./DeliveryPerformancePanel";

const iso = (s) => new Date(s).toISOString();

// One order that met T-2 and one that blew it; one delivered late.
const orders = [
  { id: "a", order_no: "SB-DLC-0326-000001", created_at: iso("2026-03-01"), delivery_date: "2026-03-20", delivered_at: iso("2026-03-20T17:00:00") },
  { id: "b", order_no: "SB-DLC-0326-000002", created_at: iso("2026-03-01"), delivery_date: "2026-03-20", delivered_at: iso("2026-03-25T10:00:00") },
];

const components = [
  { order_id: "a", current_stage: "dispatched", stage_updated_at: iso("2026-03-17") },   // before T-2 (18th)
  { order_id: "b", current_stage: "dispatched", stage_updated_at: iso("2026-03-22") },   // after T-2
];

const shipments = [{ id: "s1", order_id: "b", status: "returned" }];

test("renders all four figures without crashing", () => {
  render(<DeliveryPerformancePanel orders={orders} components={components} shipments={shipments} />);

  expect(screen.getByText("Delivery Performance")).toBeInTheDocument();
  expect(screen.getByText("On-time Production (T-2)")).toBeInTheDocument();
  expect(screen.getByText("On-time Delivery")).toBeInTheDocument();
  expect(screen.getByText("Delivery Fails")).toBeInTheDocument();

  // 1 of 2 on time on each rate card.
  expect(screen.getAllByText("50%")).toHaveLength(2);
  // The one returned shipment.
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("drilling in lists the offending order", () => {
  render(<DeliveryPerformancePanel orders={orders} components={components} shipments={shipments} />);

  // Two drill buttons (one per rate card); open the production one.
  fireEvent.click(screen.getAllByText(/View 1 late/)[0]);

  expect(screen.getByText("Missed the T-2 production deadline")).toBeInTheDocument();
  // Order b is the late one; a must not appear in the drill table.
  expect(screen.getByText("SB-DLC-0326-000002")).toBeInTheDocument();
  expect(screen.queryByText("SB-DLC-0326-000001")).not.toBeInTheDocument();
});

test("empty data renders dashes, not a fabricated 0%", () => {
  render(<DeliveryPerformancePanel orders={[]} components={[]} shipments={[]} />);
  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(screen.queryByText("0%")).not.toBeInTheDocument();
});
