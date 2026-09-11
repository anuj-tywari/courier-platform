
import { startFixtureCourierServer, FIXTURE_API_KEY } from "../tests/helpers/fixture-courier-server";

startFixtureCourierServer().then(({ url }) => {
  // eslint-disable-next-line no-console
  console.log(`Demo courier fixture server listening at ${url}`);
  // eslint-disable-next-line no-console
  console.log(`API key (X-Api-Key header): ${FIXTURE_API_KEY}`);
});
