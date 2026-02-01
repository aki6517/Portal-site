import { permanentRedirect } from "next/navigation";

export default function AdminIndexRedirect() {
  permanentRedirect("/admin/index.html");
}

