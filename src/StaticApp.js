import React, { useState } from "react";
import "./index.css";
import StaticReferenceApp from "./components/StaticReferenceApp";

const SCRIPT_URL =
  process.env.REACT_APP_GOOGLE_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbzIR8srYEDBgHOUKGfs0J3nk2BY4fsDPiw0J5cHfXUU7t77cEPWYw15mdUcW0T7oCw7Xg/exec";
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1ZB9Y-3_03NZ0Gyydfi4xzDbZQz6O62kabQpI7dkLGBc/edit?pli=1&gid=634559028#gid=634559028";

function StaticApp() {
  const [activeTab, setActiveTab] = useState("inspection");
  return (
    <StaticReferenceApp
      activeTab={activeTab}
      onTabChange={setActiveTab}
      scriptUrl={SCRIPT_URL}
      sheetUrl={SHEET_URL}
    />
  );
}

export default StaticApp;
