import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import OtpVerification from "./screens/OtpVerification";
import OtpDialogBox from "./screens/OtpDialogBox";
import CustomerDetailForm from "./screens/CustomerDetailForm";
import ProductForm from "./screens/ProductForm";
import OrderDetails from "./screens/OrderDetails";
import ReviewDetail from "./screens/ReviewDetail";
import SALogin from "./screens/SALogin";
import AssociateDashboard from "./screens/AssociateDashboard";
import WarehouseDashboard from "./screens/WarehouseDashboard";
import OrderHistory from "./screens/OrderHistory";
import OrderPlaced from "./screens/OrderPlacedScreen/OrderPlaced";
import EditOrder from "./screens/EditOrder/EditOrder";
import InventoryDashboard from "./screens/InventoryDashboard/InventoryDashboard";
import AccountsDashboard from "./screens/AccountsDashboard/AccountsDashboard";
import OrderDetailPage from "./pages/OrderDetailPage";
import AdminDashboard from "./screens/AdminDashboard/AdminDashboard";
import B2BVendorSelection from "./screens/B2bvendorSelection/B2bvendorselection";
import B2bExecutiveDashboard from "./screens/B2bExecutiveDashboard/B2bexecutivedashboard";
import B2bProductForm from "./screens/B2bproductform/B2bproductform";
import B2bOrderDetails from "./screens/B2borderdetails/B2bOrderDetails";
import B2bReviewOrder from "./screens/B2bRevieworder/B2bReviewOrder";
import B2bOrderView from "./screens/B2bOrderView/B2bOrderView";
import B2bOrderHistory from "./screens/B2bOrderHistory/B2bOrderHistory";
import B2bMerchandiserDashboard from "./screens/B2bMerchandiserDashboard/B2bMerchandiserDashboard";
import B2bVendorOrders from "./screens/B2bVendorOrders/B2bVendorOrders";
import B2bProductionDashboard from "./screens/B2bProductionDashboard/B2bProductionDashboard";
import ProductionManagerDashboard from "./components/B2B/ProductionManagerDashboard/ProductionManagerDashboard";
import GMDashboard from "./screens/GMDashboard/GMDashboard";
import RetailManagerDashboard from "./screens/RetailDashboard/RetailManagerDashboard";
import COODashboard from "./screens/COODashboard/COODashboard";
import CEODashboard from "./screens/CeoDashboard/CeoDashboard";
import StoreManagerDashboard from "./screens/StoreManagerDashboard/StoreManagerDashboard";
import CeoAssistantDashboard from "./screens/CeoAssistantDashboard/CeoAssistantDashboard";
import AssistantCmoDashboard from "./screens/AssistantCmoDashboard/AssistantCmoDashboard";
import PrivateRoute from "./components/PrivateRoute";


function App() {
  return (
    <BrowserRouter>
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

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
