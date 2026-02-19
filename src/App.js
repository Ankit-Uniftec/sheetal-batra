import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import { Navigate } from "react-router-dom";
import OrderPlaced from "./screens/OrderPlacedScreen/OrderPlaced"
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


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<SALogin />} />
        <Route path="/buyerVerification" element={<OtpVerification />} />
        <Route path="/otp" element={<OtpDialogBox />} />
        <Route path="/userinfo" element={<CustomerDetailForm />} />
        <Route path="/product" element={<ProductForm />} />
        <Route path="/confirmDetail" element={<OrderDetails />} />
        <Route path="/orderDetail" element={<ReviewDetail />} />
        <Route path="/AssociateDashboard" element={<AssociateDashboard />} />
        <Route path="/warehouseDashboard" element={<WarehouseDashboard />} />
        <Route path="/orderHistory" element={<OrderHistory />} />
        <Route path="order-placed" element={<OrderPlaced />} />
        <Route path="/edit-order" element={<EditOrder />} />
        <Route path="/inventoryDashboard" element={<InventoryDashboard />} />
        <Route path="/accounts" element={<AccountsDashboard />} />
        <Route path="/order/:orderId" element={<OrderDetailPage />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/b2b-executive-dashboard" element={<B2bExecutiveDashboard />} />
        <Route path="/b2b-vendor-selection" element={<B2BVendorSelection />} />
        <Route path="/b2b-product-form" element={<B2bProductForm />} />
        <Route path="/b2b-order-details" element={<B2bOrderDetails />} />
        <Route path="/b2b-review-order" element={<B2bReviewOrder />} />
        <Route path="/b2b-order-view/:id" element={<B2bOrderView />} />
        <Route path="/b2b-order-history" element={<B2bOrderHistory />} />
        <Route path="/b2b-merchandiser-dashboard" element={<B2bMerchandiserDashboard />} />
        <Route path="/b2b-vendor-orders/:vendorId" element={<B2bVendorOrders />} />
        <Route path="/b2b-production-dashboard" element={<B2bProductionDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
