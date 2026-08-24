export default {
  fetch() {
    return Response.json({
      service: "punks-api-fixture",
      environment: "local",
      status: "ok",
    });
  },
};
