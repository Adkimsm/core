/*
 * @FilePath: /nx-core/src/processors/helper/helper.module.ts
 * @author: Wibus
 * @Date: 2022-07-03 21:26:11
 * @LastEditors: Wibus
 * @LastEditTime: 2022-07-10 16:19:11
 * Coding With IU
 */

import { forwardRef, Global, Module, Provider } from "@nestjs/common";
import { PageModule } from "~/modules/page/page.module";
import { PostModule } from "~/modules/post/post.module";
import { HttpService } from "./helper.http.service";
import { UrlService } from "./helper.url.service";

const providers: Provider<any>[] = [HttpService, UrlService];

@Module({
  imports: [forwardRef(() => PostModule), forwardRef(() => PageModule)],
  providers,
  exports: providers,
})
@Global()
export class HelperModule {}
