import { useEffect, useState } from "react";
import { fetchShipmentsByOrder } from "../utils/shipmentStatus";

/**
 * Shipments grouped by order id, loaded once when the screen opens — for the
 * "Dispatched" badge on the production dashboards (meeting point 34). A failed
 * read leaves the map empty: the badge simply does not show, nothing else on
 * the screen depends on it.
 */
export default function useShipmentsByOrder() {
  const [byOrder, setByOrder] = useState({});
  useEffect(() => {
    let alive = true;
    fetchShipmentsByOrder()
      .then((m) => { if (alive) setByOrder(m); })
      .catch((err) => console.error("Shipments load failed (dispatch badges hidden):", err));
    return () => { alive = false; };
  }, []);
  return byOrder;
}
