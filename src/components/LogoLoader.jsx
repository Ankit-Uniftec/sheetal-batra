import React, { useEffect, useRef, useState } from "react";
import Logo from "../images/logo.png";
import LogoVideo from "../images/logo.mp4";
import LogoVideoWebm from "../images/logo.webm";
import "./LogoLoader.css";

/**
 * The animated logo on the dashboards' loading screens.
 *
 * Phones only autoplay a video they know is muted, and React's `muted` prop is
 * not written as an attribute in time for iOS Safari, which then draws its own
 * play button. So the still logo shows first, the video is muted by hand, and
 * it only replaces the still once it is really playing. If the phone refuses
 * (Low Power Mode, data saver), the still logo stays, gently pulsing: there is
 * never a play button to tap.
 */
export default function LogoLoader({ className = "" }) {
  const video = useRef(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    const attempt = v.play();
    if (attempt && typeof attempt.catch === "function") attempt.catch(() => { /* the still logo stays */ });
  }, []);

  return (
    <span className={`logo-loader${playing ? " is-playing" : ""} ${className}`} aria-hidden="true">
      <img className="logo-loader-still" src={Logo} alt="" />
      <video
        ref={video}
        className="logo-loader-video"
        autoPlay
        muted
        playsInline
        loop
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
      >
        <source src={LogoVideoWebm} type="video/webm" />
        <source src={LogoVideo} type="video/mp4" />
      </video>
    </span>
  );
}
