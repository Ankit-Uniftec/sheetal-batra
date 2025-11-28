// import React, { useState } from "react";
// import { useNavigate, useLocation } from "react-router-dom";
// import { supabase } from "../lib/supabaseClient";
// import "../screens/Screen3.css";

// function Screen3() {
//   const navigate = useNavigate();
//   const location = useLocation();

//   const phoneNumber = location.state?.phoneNumber || "";

//   // Form state
//   const [fullName, setFullName] = useState("");
//   const [gender, setGender] = useState("");
//   const [email, setEmail] = useState("");
//   const [dob, setDob] = useState("");
//   const [address, setAddress] = useState("");
//   const [city, setCity] = useState("");
//   const [state, setState] = useState("");
//   const [pincode, setPincode] = useState("");
//   const [loading, setLoading] = useState(false);

//   const saveUserInfo = async () => {
//     if (!fullName || !email) {
//       alert("Full Name and Email are required.");
//       return;
//     }

//     setLoading(true);

//     const { error } = await supabase.from("profiles").insert({
//       full_name: fullName,
//       gender,
//       phone: phoneNumber,
//       email,
//       dob,
//       address,
//       city,
//       state,
//       pincode,
//     });

//     setLoading(false);

//     if (error) {
//       alert(error.message);
//       return;
//     }

//     alert("Profile saved successfully!");

//     navigate("/product");
//   };

//   return (
//     <div className="screen3-root">
//       <div className="card3">
//         <img src="/logo.png" className="logo3" />

//         <h2>Personal information</h2>

//         <div className="row">
//           <div className="input-box">
//             <label>Full name*</label>
//             <input
//               type="text"
//               placeholder="Exp. John Carter"
//               value={fullName}
//               onChange={(e) => setFullName(e.target.value)}
//             />
//           </div>

//           <div className="input-box">
//             <label>Gender</label>
//             <input
//               type="text"
//               placeholder="Female"
//               value={gender}
//               onChange={(e) => setGender(e.target.value)}
//             />
//           </div>
//         </div>

//         <div className="row">
//           <div className="input-box">
//             <label>Phone number*</label>
//             <input type="text" value={phoneNumber} readOnly />
//           </div>

//           <div className="input-box">
//             <label>Email*</label>
//             <input
//               type="text"
//               placeholder="Enter your email"
//               value={email}
//               onChange={(e) => setEmail(e.target.value)}
//             />
//           </div>

//           <div className="input-box">
//             <label>DOB</label>
//             <input
//               type="date"
//               value={dob}
//               onChange={(e) => setDob(e.target.value)}
//             />
//           </div>
//         </div>

//         <div className="input-box">
//           <label>Address</label>
//           <input
//             type="text"
//             placeholder="House no., street address"
//             value={address}
//             onChange={(e) => setAddress(e.target.value)}
//           />
//         </div>

//         <div className="row">
//           <div className="input-box">
//             <label>City</label>
//             <input
//               type="text"
//               placeholder="Exp. Delhi"
//               value={city}
//               onChange={(e) => setCity(e.target.value)}
//             />
//           </div>

//           <div className="input-box">
//             <label>State</label>
//             <input
//               type="text"
//               placeholder="Exp. Delhi"
//               value={state}
//               onChange={(e) => setState(e.target.value)}
//             />
//           </div>

//           <div className="input-box">
//             <label>Pincode</label>
//             <input
//               type="text"
//               placeholder="Exp. 110018"
//               value={pincode}
//               onChange={(e) => setPincode(e.target.value)}
//             />
//           </div>
//         </div>

//         <button className="btn3" onClick={saveUserInfo} disabled={loading}>
//           {loading ? "Saving..." : "Continue"}
//         </button>
//       </div>
//     </div>
//   );
// }

// export default Screen3;

import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "../screens/Screen3.css";

function Screen3() {
  const navigate = useNavigate();
  const location = useLocation();

  const phoneNumber = location.state?.phoneNumber || "";

  // State
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [loading, setLoading] = useState(false);

  const saveUserInfo = async () => {
    if (!fullName || !email) {
      alert("Full Name and Email are required.");
      return;
    }

    setLoading(true);

    const normalized = "+91" + phoneNumber.replace(/\D/g, "").slice(-10);

    const { error } = await supabase.from("profiles").insert({
      full_name: fullName,
      gender,
      phone: normalized,
      email,
      dob,
      address,
      city,
      state,
      pincode,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Profile saved successfully!");
    navigate("/product");
  };

  return (
    <div className="screen3-root">
      <div className="card3">
        <img src="/logo.png" className="logo3" />

        <h2>Personal information</h2>

        <div className="row">
          <div className="input-box">
            <label>Full name*</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          <div className="input-box">
            <label>Gender</label>
            <input value={gender} onChange={(e) => setGender(e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div className="input-box">
            <label>Phone number*</label>
            <input type="text" value={phoneNumber} readOnly />
          </div>

          <div className="input-box">
            <label>Email*</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="input-box">
            <label>DOB</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
        </div>

        <div className="input-box">
          <label>Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="row">
          <div className="input-box">
            <label>City</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div className="input-box">
            <label>State</label>
            <input value={state} onChange={(e) => setState(e.target.value)} />
          </div>

          <div className="input-box">
            <label>Pincode</label>
            <input value={pincode} onChange={(e) => setPincode(e.target.value)} />
          </div>
        </div>

        <button className="btn3" onClick={saveUserInfo} disabled={loading}>
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

export default Screen3;
