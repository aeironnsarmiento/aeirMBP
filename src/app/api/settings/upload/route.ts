import {
  handleBackgroundDelete,
  handleUploadConfirm,
  handleUploadSign,
} from "@/widgets/settings/server/handlers";

export const POST = handleUploadSign;
export const PUT = handleUploadConfirm;
export const DELETE = handleBackgroundDelete;
