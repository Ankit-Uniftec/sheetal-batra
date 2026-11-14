import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import UpdateBanner from "./components/UpdateBanner";
import PrivateRoute from "./components/PrivateRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import { importFresh } from "./utils/chunkReload";

// Every screen is lazy-loaded so each route ships as its own chunk instead of
// one monolithic bundle — users only download the dashboard they open.
const OtpVerification = lazy(() => importFresh(() => import("./screens/OtpVerification")));
const OtpDialogBox = lazy(() => importFresh(() => import("./screens/OtpDialogBox")));
const CustomerDetailForm = lazy(() => importFresh(() => import("./screens/CustomerDetailForm")));
const ProductForm = lazy(() => importFresh(() => import("./screens/ProductForm")));
const OrderDetails = lazy(() => importFresh(() => import("./screens/OrderDetails")));
const ReviewDetail = lazy(() => importFresh(() => import("./screens/ReviewDetail")));
const SALogin = lazy(() => importFresh(() => import("./screens/SALogin")));
const AssociateDashboard = lazy(() => importFresh(() => import("./screens/AssociateDashboard")));
const WarehouseDashboard = lazy(() => importFresh(() => import("./screens/WarehouseDashboard")));
const OrderHistory = lazy(() => importFresh(() => import("./screens/OrderHistory")));
const OrderPlaced = lazy(() => importFresh(() => import("./screens/OrderPlacedScreen/OrderPlaced")));
const EditOrder = lazy(() => importFresh(() => import("./screens/EditOrder/EditOrder")));
const InventoryDashboard = lazy(() => importFresh(() => import("./screens/InventoryDashboard/InventoryDashboard")));
const StockRoom = lazy(() => importFresh(() => import("./screens/StockRoom/StockRoom")));
const AccountsDashboard = lazy(() => importFresh(() => import("./screens/AccountsDashboard/AccountsDashboard")));
const AccountantDashboard = lazy(() => importFresh(() => import("./screens/AccountantDashboard/AccountantDashboard")));
const HeadOfDesignDashboard = lazy(() => importFresh(() => import("./screens/HeadOfDesignDashboard/HeadOfDesignDashboard")));
const ScanStationPage = lazy(() => importFresh(() => import("./screens/ScanStationPage/ScanStationPage")));
const OrderDetailPage = lazy(() => importFresh(() => import("./pages/OrderDetailPage")));
const AdminDashboard = lazy(() => importFresh(() => import("./screens/AdminDashboard/AdminDashboard")));
const B2BVendorSelection = lazy(() => importFresh(() => import("./screens/B2bvendorSelection/B2bvendorselection")));
const B2bExecutiveDashboard = lazy(() => importFresh(() => import("./screens/B2bExecutiveDashboard/B2bexecutivedashboard")));
const B2bProductForm = lazy(() => importFresh(() => import("./screens/B2bproductform/B2bproductform")));
const B2bOrderDetails = lazy(() => importFresh(() => import("./screens/B2borderdetails/B2bOrderDetails")));
const B2bReviewOrder = lazy(() => importFresh(() => import("./screens/B2bRevieworder/B2bReviewOrder")));
const B2bOrderView = lazy(() => importFresh(() => import("./screens/B2bOrderView/B2bOrderView")));
const B2bOrderHistory = lazy(() => importFresh(() => import("./screens/B2bOrderHistory/B2bOrderHistory")));
const B2bMerchandiserDashboard = lazy(() => importFresh(() => import("./screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard")));
const B2bVendorOrders = lazy(() => importFresh(() => import("./screens/B2bVendorOrders/B2bVendorOrders")));
const B2bProductionDashboard = lazy(() => importFresh(() => import("./screens/B2bProductionDashboard/B2bProductionDashboard")));
const ProductionManagerDashboard = lazy(() => importFresh(() => import("./components/B2B/ProductionManagerDashboard/ProductionManagerDashboard")));
const PmDashboard = lazy(() => importFresh(() => import("./screens/ProductionManager/PmDashboard")));
const GMDashboard = lazy(() => importFresh(() => import("./screens/GMDashboard/GMDashboard")));
const RetailManagerDashboard = lazy(() => importFresh(() => import("./screens/RetailDashboard/RetailManagerDashboard")));
const COODashboard = lazy(() => importFresh(() => import("./screens/COODashboard/COODashboard")));
const CEODashboard = lazy(() => importFresh(() => import("./screens/CeoDashboard/CeoDashboard")));
const StoreManagerDashboard = lazy(() => importFresh(() => import("./screens/StoreManagerDashboard/StoreManagerDashboard")));
const CeoAssistantDashboard = lazy(() => importFresh(() => import("./screens/CeoAssistantDashboard/CeoAssistantDashboard")));
const AssistantCmoDashboard = lazy(() => importFresh(() => import("./screens/AssistantCmoDashboard/AssistantCmoDashboard")));
const CommsDashboard = lazy(() => importFresh(() => import("./screens/CommsDashboard/CommsDashboard")));
const CommsDashboardClassic = lazy(() => importFresh(() => import("./screens/CommsDashboard/CommsDashboardClassic")));
const WalkInDashboard = lazy(() => importFresh(() => import("./screens/WalkInDashboard/WalkInDashboard")));
const CommsOrderForm = lazy(() => importFresh(() => import("./screens/CommsDashboard/CommsOrderForm")));
const CommsReviewOrder = lazy(() => importFresh(() => import("./screens/CommsDashboard/CommsReviewOrder")));
const ShopifyOrdersDashboard = lazy(() => importFresh(() => import("./screens/ShopifyOrdersDashboard/ShopifyOrdersDashboard")));
const PackagingDashboard = lazy(() => importFresh(() => import("./screens/PackagingDashboard/PackagingDashboard")));

const routeFallback = (
  <div
    style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#666",
    }}
  >
    Loading...
  </div>
);

function App() {
  return (
    <BrowserRouter>
      {/* Long-running tabs get a refresh prompt when a new build is deployed. */}
      <UpdateBanner />
      <ErrorBoundary>
        <Suspense fallback={routeFallback}>
          <Routes>
        {/* Public routes */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<SALogin />} />
        <Route path="/buyerVerification" element={<OtpVerification />} />
        <Route path="/otp" element={<OtpDialogBox />} />

        {/* Protected routes */}
        <Route path="/userinfo" element={<PrivateRoute><CustomerDetailForm /></PrivateRoute>} />
        <Route path="/product" element={<PrivateRoute><ProductForm /></PrivateRoute>} />
        <Route path="/confirmDetail" element={<PrivateRoute><OrderDetails /></PrivateRoute>} />
        <Route path="/orderDetail" element={<PrivateRoute><ReviewDetail /></PrivateRoute>} />
        <Route path="/AssociateDashboard" element={<PrivateRoute><AssociateDashboard /></PrivateRoute>} />
        <Route path="/warehouseDashboard" element={<PrivateRoute><WarehouseDashboard /></PrivateRoute>} />
        <Route path="/orderHistory" element={<PrivateRoute><OrderHistory /></PrivateRoute>} />
        <Route path="order-placed" element={<PrivateRoute><OrderPlaced /></PrivateRoute>} />
        <Route path="/edit-order" element={<PrivateRoute><EditOrder /></PrivateRoute>} />
        <Route path="/inventoryDashboard" element={<PrivateRoute><InventoryDashboard /></PrivateRoute>} />
        <Route path="/stock-room" element={<PrivateRoute><StockRoom /></PrivateRoute>} />
        <Route path="/accounts" element={<PrivateRoute><AccountsDashboard /></PrivateRoute>} />
        <Route path="/accountant-dashboard" element={<PrivateRoute><AccountantDashboard /></PrivateRoute>} />
        <Route path="/head-of-design-dashboard" element={<PrivateRoute><HeadOfDesignDashboard /></PrivateRoute>} />
        <Route path="/scan-station" element={<PrivateRoute><ScanStationPage /></PrivateRoute>} />
        <Route path="/order/:orderId" element={<PrivateRoute><OrderDetailPage /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute><AdminDashboard /></PrivateRoute>} />
        <Route path="/b2b-executive-dashboard" element={<PrivateRoute><B2bExecutiveDashboard /></PrivateRoute>} />
        <Route path="/b2b-vendor-selection" element={<PrivateRoute><B2BVendorSelection /></PrivateRoute>} />
        <Route path="/b2b-product-form" element={<PrivateRoute><B2bProductForm /></PrivateRoute>} />
        <Route path="/b2b-order-details" element={<PrivateRoute><B2bOrderDetails /></PrivateRoute>} />
        <Route path="/b2b-review-order" element={<PrivateRoute><B2bReviewOrder /></PrivateRoute>} />
        <Route path="/b2b-order-view/:id" element={<PrivateRoute><B2bOrderView /></PrivateRoute>} />
        <Route path="/b2b-order-history" element={<PrivateRoute><B2bOrderHistory /></PrivateRoute>} />
        <Route path="/b2b-merchandiser-dashboard" element={<PrivateRoute><B2bMerchandiserDashboard /></PrivateRoute>} />
        <Route path="/b2b-vendor-orders/:vendorId" element={<PrivateRoute><B2bVendorOrders /></PrivateRoute>} />
        <Route path="/b2b-production-dashboard" element={<PrivateRoute><B2bProductionDashboard /></PrivateRoute>} />
        <Route path="/production-manager-dashboard" element={<PrivateRoute><PmDashboard /></PrivateRoute>} />
        <Route path="/production-manager-dashboard/classic" element={<PrivateRoute><ProductionManagerDashboard /></PrivateRoute>} />
        <Route path="/gm-dashboard" element={<PrivateRoute><GMDashboard /></PrivateRoute>} />
        <Route path="/retail-manager-dashboard" element={<PrivateRoute><RetailManagerDashboard /></PrivateRoute>} />
        <Route path="/coo-dashboard" element={<PrivateRoute><COODashboard /></PrivateRoute>} />
        <Route path="/ceo-dashboard" element={<PrivateRoute><CEODashboard /></PrivateRoute>} />
        <Route path="/store-manager-dashboard" element={<PrivateRoute><StoreManagerDashboard /></PrivateRoute>} />
        <Route path="/ceo-assistant-dashboard" element={<PrivateRoute><CeoAssistantDashboard /></PrivateRoute>} />
        <Route path="/assistant-cmo-dashboard" element={<PrivateRoute><AssistantCmoDashboard /></PrivateRoute>} />
        <Route path="/comms-dashboard" element={<PrivateRoute><CommsDashboard /></PrivateRoute>} />
        <Route path="/comms-dashboard/classic" element={<PrivateRoute><CommsDashboardClassic /></PrivateRoute>} />
        <Route path="/walkin-dashboard" element={<PrivateRoute><WalkInDashboard /></PrivateRoute>} />
        <Route path="/comms-order-form" element={<PrivateRoute><CommsOrderForm /></PrivateRoute>} />
        <Route path="/comms-review-order" element={<PrivateRoute><CommsReviewOrder /></PrivateRoute>} />
        <Route path="/shopify-orders-dashboard" element={<PrivateRoute><ShopifyOrdersDashboard /></PrivateRoute>} />
        <Route path="/packaging-dashboard" element={<PrivateRoute><PackagingDashboard /></PrivateRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
