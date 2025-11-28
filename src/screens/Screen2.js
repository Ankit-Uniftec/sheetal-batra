// import React, { useState, useEffect, useRef } from "react";
// import { useLocation, useNavigate } from "react-router-dom";
// import { supabase } from "../lib/supabaseClient";
// import "./Screen2.css";

// export default function Screen2() {
//   const location = useLocation();
//   const navigate = useNavigate();

//   // get phone values passed from Screen1
//   const mobile = location.state?.mobile;
//   const phoneNumber = location.state?.phoneNumber;

//   const [time, setTime] = useState(30);
//   const [loading, setLoading] = useState(false);
//   const [otp, setOtp] = useState(["", "", "", "", "", ""]);
//   const inputRefs = useRef([]);

//   // Countdown Timer
//   useEffect(() => {
//     const timer = setInterval(() => {
//       setTime((prev) => (prev > 0 ? prev - 1 : 0));
//     }, 1000);

//     return () => clearInterval(timer);
//   }, []);

//   // Auto move between OTP fields
//   const handleChange = (value, index) => {
//     if (!/^\d*$/.test(value)) return; // Only numbers allowed

//     const updatedOtp = [...otp];
//     updatedOtp[index] = value;
//     setOtp(updatedOtp);

//     // auto focus next input
//     if (value && index < 5) {
//       inputRefs.current[index + 1].focus();
//     }
//   };

//   // Backspace navigation
//   const handleKeyDown = (e, index) => {
//     if (e.key === "Backspace" && otp[index] === "" && index > 0) {
//       inputRefs.current[index - 1].focus();
//     }
//   };
//   // Verify OTP
//   const verifyOTP = async () => {
//     const code = otp.join("");

//     if (code.length !== 6) {
//       alert("Enter a valid 6-digit OTP");
//       return;
//     }

//     setLoading(true);

//     const { data: otpData, error } = await supabase.auth.verifyOtp({
//       phone: phoneNumber,
//       token: code,
//       type: "sms",
//     });

//     setLoading(false);

//     if (error) {
//       alert(error.message);
//       return;
//     }

//     // ✔ OTP success
//     alert("Login Successful!");

//     // 🔥 Check if profile already exists
//     const { data: existingProfile, error: profileError } = await supabase
//       .from("profiles")
//       .select("*")
//       .eq("phone", phoneNumber)
//       .single();

//     if (existingProfile) {
//       // ✔ User already has profile → skip Screen3
//       navigate("/product");
//       return;
//     }

//     // ❌ No profile found → go to Screen3
//     navigate("/userinfo", {
//       state: { phoneNumber },
//     });
//   };


//   return (
//     <div className="screen2-bg">
//       <div className="card">
//         <h1 className="title">Welcome to Sheetal Batra</h1>

//         <p className="subtitle">
//           Your personalised Sheetal Batra experience awaits.
//         </p>

//         <p className="otp-text">OTP has been sent to +91 {mobile}</p>

//         {/* OTP Boxes */}
//         <div className="otpBox">
//           {otp.map((value, i) => (
//             <input
//               key={i}
//               className="otp-input"
//               maxLength={1}
//               value={value}
//               ref={(el) => (inputRefs.current[i] = el)}
//               onChange={(e) => handleChange(e.target.value, i)}
//               onKeyDown={(e) => handleKeyDown(e, i)}
//             />
//           ))}
//         </div>

//         <button className="btn2" onClick={verifyOTP} disabled={loading}>
//           {loading ? "Verifying..." : "Continue"}
//         </button>

//         <p className="timer-text">
//           You can resend the code in {time} seconds
//         </p>
//       </div>
//     </div>
//   );
// }


import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen2.css";

export default function Screen2() {
  const location = useLocation();
  const navigate = useNavigate();

  const mobile = location.state?.mobile; // 10 digits only
  const phoneNumber = location.state?.phoneNumber; // +91XXXXXXXXXX

  const [time, setTime] = useState(30);
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef([]);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTime((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handle OTP input
  const handleChange = (value, index) => {
    if (!/^\d*$/.test(value)) return;
    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);
    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && otp[index] === "" && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  // // Verify OTP
  // const verifyOTP = async () => {
  //   const code = otp.join("");

  //   if (code.length !== 6) {
  //     alert("Enter a valid 6-digit OTP");
  //     return;
  //   }

  //   setLoading(true);

  //   const { error } = await supabase.auth.verifyOtp({
  //     phone: phoneNumber,
  //     token: code,
  //     type: "sms",
  //   });

  //   setLoading(false);

  //   if (error) {
  //     alert(error.message);
  //     return;
  //   }

  //   alert("Login Successful!");

  //   // Normalize phone to +91XXXXXXXXXX
  //   const normalized = phoneNumber.replace(/\D/g, "").slice(-10);
  //   const formatted = "+91" + normalized;

  //   // Check if profile exists
  //   const { data: existingProfile } = await supabase
  //     .from("profiles")
  //     .select("*")
  //     .eq("phone", formatted)
  //     .maybeSingle();

  //   if (existingProfile) {
  //     navigate("/product");
  //     return;
  //   }

  //   navigate("/userinfo", { state: { phoneNumber: formatted } });
  // };

  const verifyOTP = async () => {
  const code = otp.join("");

  if (code.length !== 6) {
    alert("Enter a valid 6-digit OTP");
    return;
  }

  setLoading(true);

  const { data: otpData, error } = await supabase.auth.verifyOtp({
    phone: phoneNumber,
    token: code,
    type: "sms",
  });

  setLoading(false);

  if (error) {
    alert(error.message);
    return;
  }

  alert("Login Successful!");

  // Normalize
  const normalized = phoneNumber.replace(/\D/g, "").slice(-10);
  const formatted = "+91" + normalized;

  console.log("📞 OTP phoneNumber:", phoneNumber);
  console.log("📞 normalized:", normalized);
  console.log("📞 formatted:", formatted);

  // Check profile
  const { data: existingProfile, error: profileErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("phone", formatted)
    .maybeSingle();

  console.log("🔍 existingProfile:", existingProfile);
  console.log("🔍 profileErr:", profileErr);

  if (existingProfile) {
    console.log("🎉 Profile FOUND! Navigating to product...");
    navigate("/product");
  } else {
    console.log("❌ Profile NOT found! Navigating to Screen3...");
    navigate("/userinfo", { state: { phoneNumber: formatted } });
  }
};


  return (
    <div className="screen2-bg">
      <div className="card">
        <h1 className="title">Welcome to Sheetal Batra</h1>
        <p className="subtitle">Your personalised Sheetal Batra experience awaits.</p>

        <p className="otp-text">OTP has been sent to +91 {mobile}</p>

        <div className="otpBox">
          {otp.map((v, i) => (
            <input
              key={i}
              maxLength={1}
              ref={(el) => (inputRefs.current[i] = el)}
              value={v}
              onChange={(e) => handleChange(e.target.value, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className="otp-input"
            />
          ))}
        </div>

        <button className="btn2" onClick={verifyOTP} disabled={loading}>
          {loading ? "Verifying..." : "Continue"}
        </button>

        <p className="timer-text">You can resend the code in {time} seconds</p>
      </div>
    </div>
  );
}
