import React from "react";
import {createRoot} from "react-dom/client";
import Forecasting from "../../app/forecasting-workspace";
createRoot(document.getElementById("root")!).render(<Forecasting activeLocationId={null} currency="CAD" navigate={view=>alert(`Preview navigation: ${view}`)}/>);
