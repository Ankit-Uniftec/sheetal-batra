import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import UpdateBanner from "./components/UpdateBanner";
import PrivateRoute from "./components/PrivateRoute";
import ErrorBoundary from "./components/ErrorBoundary";

// Every screen is lazy-loaded so each route ships as its own chunk instead of
// one monolithic bundle — users only download the dashboard they open.
const OtpVerification = lazy(() => import("./screens/OtpVerification"));
const OtpDialogBox = lazy(() => import("./screens/OtpDialogBox"));
const CustomerDetailForm = lazy(() => import("./screens/CustomerDetailForm"));
const ProductForm = lazy(() => import("./screens/ProductForm"));
const OrderDetails = lazy(() => import("./screens/OrderDetails"));
const ReviewDetail = lazy(() => import("./screens/ReviewDetail"));
const SALogin = lazy(() => import("./screens/SALogin"));
const AssociateDashboard = lazy(() => import("./screens/AssociateDashboard"));
const WarehouseDashboard = lazy(() => import("./screens/WarehouseDashboard"));
const OrderHistory = lazy(() => import("./screens/OrderHistory"));
const OrderPlaced = lazy(() => import("./screens/OrderPlacedScreen/OrderPlaced"));
const EditOrder = lazy(() => import("./screens/EditOrder/EditOrder"));
const InventoryDashboard = lazy(() => import("./screens/InventoryDashboard/InventoryDashboard"));
const AccountsDashboard = lazy(() => import("./screens/AccountsDashboard/AccountsDashboard"));
const AccountantDashboard = lazy(() => import("./screens/AccountantDashboard/AccountantDashboard"));
const HeadOfDesignDashboard = lazy(() => import("./screens/HeadOfDesignDashboard/HeadOfDesignDashboard"));
const ScanStationPage = lazy(() => import("./screens/ScanStationPage/ScanStationPage"));
const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage"));
const AdminDashboard = lazy(() => import("./screens/AdminDashboard/AdminDashboard"));
const B2BVendorSelection = lazy(() => import("./screens/B2bvendorSelection/B2bvendorselection"));
const B2bExecutiveDashboard = lazy(() => import("./screens/B2bExecutiveDashboard/B2bexecutivedashboard"));
const B2bProductForm = lazy(() => import("./screens/B2bproductform/B2bproductform"));
const B2bOrderDetails = lazy(() => import("./screens/B2borderdetails/B2bOrderDetails"));
const B2bReviewOrder = lazy(() => import("./screens/B2bRevieworder/B2bReviewOrder"));
const B2bOrderView = lazy(() => import("./screens/B2bOrderView/B2bOrderView"));
const B2bOrderHistory = lazy(() => import("./screens/B2bOrderHistory/B2bOrderHistory"));
const B2bMerchandiserDashboard = lazy(() => import("./screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard"));
const B2bVendorOrders = lazy(() => import("./screens/B2bVendorOrders/B2bVendorOrders"));
const B2bProductionDashboard = lazy(() => import("./screens/B2bProductionDashboard/B2bProductionDashboard"));
const ProductionManagerDashboard = lazy(() => import("./components/B2B/ProductionManagerDashboard/ProductionManagerDashboard"));
const GMDashboard = lazy(() => import("./screens/GMDashboard/GMDashboard"));
const RetailManagerDashboard = lazy(() => import("./screens/RetailDashboard/RetailManagerDashboard"));
const COODashboard = lazy(() => import("./screens/COODashboard/COODashboard"));
const CEODashboard = lazy(() => import("./screens/CeoDashboard/CeoDashboard"));
const StoreManagerDashboard = lazy(() => import("./screens/StoreManagerDashboard/StoreManagerDashboard"));
const CeoAssistantDashboard = lazy(() => import("./screens/CeoAssistantDashboard/CeoAssistantDashboard"));
const AssistantCmoDashboard = lazy(() => import("./screens/AssistantCmoDashboard/AssistantCmoDashboard"));
const CommsDashboard = lazy(() => import("./screens/CommsDashboard/CommsDashboard"));
const WalkInDashboard = lazy(() => import("./screens/WalkInDashboard/WalkInDashboard"));
const CommsOrderForm = lazy(() => import("./screens/CommsDashboard/CommsOrderForm"));
const CommsReviewOrder = lazy(() => import("./screens/CommsDashboard/CommsReviewOrder"));
const ShopifyOrdersDashboard = lazy(() => import("./screens/ShopifyOrdersDashboard/ShopifyOrdersDashboard"));

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
        <Route path="/production-manager-dashboard" element={<PrivateRoute><ProductionManagerDashboard /></PrivateRoute>} />
        <Route path="/gm-dashboard" element={<PrivateRoute><GMDashboard /></PrivateRoute>} />
        <Route path="/retail-manager-dashboard" element={<PrivateRoute><RetailManagerDashboard /></PrivateRoute>} />
        <Route path="/coo-dashboard" element={<PrivateRoute><COODashboard /></PrivateRoute>} />
        <Route path="/ceo-dashboard" element={<PrivateRoute><CEODashboard /></PrivateRoute>} />
        <Route path="/store-manager-dashboard" element={<PrivateRoute><StoreManagerDashboard /></PrivateRoute>} />
        <Route path="/ceo-assistant-dashboard" element={<PrivateRoute><CeoAssistantDashboard /></PrivateRoute>} />
        <Route path="/assistant-cmo-dashboard" element={<PrivateRoute><AssistantCmoDashboard /></PrivateRoute>} />
        <Route path="/comms-dashboard" element={<PrivateRoute><CommsDashboard /></PrivateRoute>} />
        <Route path="/walkin-dashboard" element={<PrivateRoute><WalkInDashboard /></PrivateRoute>} />
        <Route path="/comms-order-form" element={<PrivateRoute><CommsOrderForm /></PrivateRoute>} />
        <Route path="/comms-review-order" element={<PrivateRoute><CommsReviewOrder /></PrivateRoute>} />
        <Route path="/shopify-orders-dashboard" element={<PrivateRoute><ShopifyOrdersDashboard /></PrivateRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
