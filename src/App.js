import { BrowserRouter, Routes, Route } from "react-router-dom";
import OtpVerification from "./screens/OtpVerification";
import OtpDialogBox from "./screens/OtpDialogBox";
import CustomerDetailForm from "./screens/CustomerDetailForm";
import ProductForm from "./screens/ProductForm";
import OrderDetails  from "./screens/OrderDetails";
import ReviewDetail from "./screens/ReviewDetail";
import SALogin from "./screens/SALogin";
import AssociateDashboard from "./screens/AssociateDashboard";
import WarehouseDashboard from "./screens/WarehouseDashboard";
import OrderHistory from "./screens/OrderHistory";
import {  Navigate } from "react-router-dom";
import OrderPlaced from "./screens/OrderPlacedScreen/OrderPlaced"
import EditOrder from "./screens/EditOrder/EditOrder";
import InventoryDashboard from "./screens/InventoryDashboard/InventoryDashboard";


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
        <Route path="/confirmDetail" element={<OrderDetails/>}/>
        <Route path="/orderDetail" element={<ReviewDetail/>}/>
        <Route path="/AssociateDashboard" element={<AssociateDashboard />} />
        <Route path="/warehouseDashboard" element={<WarehouseDashboard />} />
        <Route path="/orderHistory" element={<OrderHistory />} />
        <Route path="order-placed" element={<OrderPlaced />}/>
        <Route path="/edit-order" element={<EditOrder/>}/>
        <Route path="/inventoryDashboard" element={<InventoryDashboard/>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
