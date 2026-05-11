import "./ui/theme.css";
import { bootstrapApp } from "./app/bootstrap";

const appNode = document.getElementById("app");

if (!appNode) {
  throw new Error("Missing #app root");
}

void bootstrapApp(appNode);
