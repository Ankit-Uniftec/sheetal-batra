

// import React, { useState } from "react";
// import { useNavigate, useLocation } from "react-router-dom";
// import { supabase } from "../lib/supabaseClient";
// import "./Screen1.css";
// import Logo from "../images/logo.png";

// export default function Screen1() {
//   const navigate = useNavigate();
//   const location = useLocation();

//   const [mobile, setMobile] = useState("");
//   const [loading, setLoading] = useState(false);
//   const [countryCode, setCountryCode] = useState("+91");

//   // -------------------------------------------------------
//   // BACK BUTTON: Determine if user came from AssociateDashboard
//   // -------------------------------------------------------
//   const handleBack = () => {
//     if (location.state?.fromAssociate) {
//       // Send flag so dashboard will require password again
//       navigate("/AssociateDashboard", {
//         state: { fromBuyerVerification: true }
//       });
//     } else {
//       navigate(-1);
//     }
//   };
// //country code----------------------
// const COUNTRY_CODES = [
//   { code: "+91", label: "India", flag: "🇮🇳" },
//   { code: "+1", label: "USA", flag: "🇺🇸" },
//   { code: "+44", label: "UK", flag: "🇬🇧" },
//   { code: "+61", label: "Australia", flag: "🇦🇺" },
//   { code: "+971", label: "UAE", flag: "🇦🇪" },
// ];

// //---------------------------------
//   // -------------------------------------------------------
//   // SEND OTP
//   // -------------------------------------------------------
//   const handleContinue = async () => {
//     const normalized = mobile.replace(/\D/g, "").slice(-10);

//     if (normalized.length !== 10) {
//       alert("Please enter a valid 10-digit mobile number");
//       return;
//     }

//     const phoneNumber = "+91" + normalized;
//     setLoading(true);

//     const { error } = await supabase.auth.signInWithOtp({
//       phone: phoneNumber,
//     });

//     setLoading(false);

//     if (error) {
//       alert(error.message);
//       return;
//     }

//     navigate("/otp", {
//       state: { 
//         mobile: normalized, 
//         phoneNumber,
//         fromAssociate: location.state?.fromAssociate || false
//       }
//     });
//   };

//   return (
//     <div className="screen1">
      
//       {/* BACK BUTTON */}
//       <button className="back-btn" onClick={handleBack}>←</button>

//       <img src={Logo} alt="logo" className="logo" />

//       <div className="card">

//         <div style={{
//           textAlign: 'center',
//           alignItems: "center",
//           justifyContent: "center",
//           width: '372px'
//         }}>
//           <h2>Welcome to Sheetal Batra</h2>
//           <p className="card-p" >Your personalised experience awaits.</p>
//         </div>

//         <div style={{ width: '372px' }}>
//           <input
//             className="input"
//             placeholder="Enter your mobile number"
//             value={mobile}
//             onChange={(e) => setMobile(e.target.value)}
//           />

//           <button className="btn" onClick={handleContinue} disabled={loading}>
//             {loading ? "Sending OTP..." : "Continue"}
//           </button>
//         </div>

//         <small>
//           By continuing, you agree to our{" "}
//           <a href="https://sheetalbatra.com/pages/privacy-policy" style={{ color: '#D5B85A !important' }}>Terms & Privacy Policy</a>
//         </small>
//       </div>
//     </div>
//   );
// }


import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";
import Logo from "../images/logo.png";

/* ----------------------------------
   COUNTRY CODE CONFIG (OBJECT ARRAY)
----------------------------------- */
const COUNTRY_CODES = [
  { code: "+91", label: "India", flag: "🇮🇳" },
  { code: "+1", label: "USA", flag: "🇺🇸" },
  { code: "+44", label: "UK", flag: "🇬🇧" },
  { code: "+61", label: "Australia", flag: "🇦🇺" },
  { code: "+971", label: "UAE", flag: "🇦🇪" },
];

export default function Screen1() {
  const navigate = useNavigate();
  const location = useLocation();

  const [countryCode, setCountryCode] = useState("+91");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------
  // BACK BUTTON
  // -------------------------------------------------------
  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true },
      });
    } else {
      navigate(-1);
    }
  };

  // -------------------------------------------------------
  // SEND OTP
  // -------------------------------------------------------
  const handleContinue = async () => {
    const normalized = mobile.replace(/\D/g, "");

    if (normalized.length < 6) {
      alert("Please enter a valid mobile number");
      return;
    }

    const phoneNumber = `${countryCode}${normalized}`;
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneNumber,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    navigate("/otp", {
      state: {
        mobile: normalized,
        phoneNumber,
        fromAssociate: location.state?.fromAssociate || false,
      },
    });
  };

  return (
    <div className="screen1">
      {/* BACK BUTTON */}
      <button className="back-btn" onClick={handleBack}>
        ←
      </button>

      <img src={Logo} alt="logo" className="logo" onClick={handleBack} />

      <div className="card">
        <div
          style={{
            textAlign: "center",
            alignItems: "center",
            justifyContent: "center",
            width: "372px",
          }}
        >
          <h2>Welcome to Sheetal Batra</h2>
          <p className="card-p">Your personalised experience awaits.</p>
        </div>

        {/* PHONE INPUT WITH COUNTRY CODE */}
        <div className="phone-wrapper">
          <select
            className="country-code"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code} 
              </option>
            ))}
          </select>

          <input
            className="phone-input"
            placeholder="Enter mobile number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </div>

        <button className="btn" onClick={handleContinue} disabled={loading}>
          {loading ? "Sending OTP..." : "Continue"}
        </button>

        <small>
          By continuing, you agree to our{" "}
          <a
            href="https://sheetalbatra.com/pages/privacy-policy"
           
          >
            Terms & Privacy Policy
          </a>
        </small>
      </div>
    </div>
  );
}
