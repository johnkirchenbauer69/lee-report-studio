import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BenchmarkPage } from "./renderers/browser/BenchmarkPage";
import {
  BenchmarkPrintReport,
  PrintReport,
} from "./renderers/browser/PrintReport";
import "./styles/app.css";
import "./styles/advanced.css";

const params = new URLSearchParams(window.location.search);
const benchmark = params.get("benchmark") === "1";
const printJob = params.get("printJob");
const printBenchmark = params.get("printBenchmark") === "1";
const content = printJob ? (
  <PrintReport jobId={printJob} />
) : printBenchmark ? (
  <BenchmarkPrintReport />
) : benchmark ? (
  <BenchmarkPage pageIndex={Number(params.get("page") ?? 0)} />
) : (
  <App />
);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{content}</React.StrictMode>,
);
