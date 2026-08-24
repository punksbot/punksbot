export default {
  fetch() {
    return Response.json({
      service: "punks-auth-fixture",
      environment: "local",
      status: "ok",
    });
  },
};
