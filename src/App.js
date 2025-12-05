import { BrowserRouter, Routes, Route } from "react-router-dom";
import Screen1 from "./screens/Screen1";
import Screen2 from "./screens/Screen2";
import Screen3 from "./screens/Screen3";
import Screen4 from "./screens/Screen4";
import Screen6  from "./screens/Screen6";
import Screen7 from "./screens/Screen7";
import SALogin from "./screens/SALogin";
import AssociateDashboard from "./screens/AssociateDashboard";
import WarehouseDashboard from "./screens/WarehouseDashboard";
import OrderHistory from "./screens/OrderHistory";
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<SALogin />} />
        <Route path="/buyerVerification" element={<Screen1 />} />
        <Route path="/otp" element={<Screen2 />} />
        <Route path="/userinfo" element={<Screen3 />} /> 
        <Route path="/product" element={<Screen4 />} />
        <Route path="/confirmDetail" element={<Screen6/>}/>
        <Route path="/payment" element={<Screen7/>}/>
        <Route path="/AssociateDashboard" element={<AssociateDashboard />} />
        <Route path="/warehouseDashboard" element={<WarehouseDashboard />} />
        <Route path="/orderHistory" element={<OrderHistory />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
