import { BrowserRouter, Routes, Route } from "react-router-dom";
import Screen1 from "./screens/Screen1";
import Screen2 from "./screens/Screen2";
import Screen3 from "./screens/Screen3";
import Screen4 from "./screens/Screen4";
import Screen6  from "./screens/Screen6";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Screen1 />} />
        <Route path="/otp" element={<Screen2 />} />
        <Route path="/userinfo" element={<Screen3 />} /> 
        <Route path="/product" element={<Screen4 />} />
        <Route path="/confirmDetail" element={<Screen6/>}/>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
