import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from "./context/AuthContext";
import App from './App';

// Buffer polyfill - must be after imports but before render
window.Buffer = Buffer;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <AuthProvider>
        <App />
    </AuthProvider>
);