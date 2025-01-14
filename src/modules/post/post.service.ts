import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
} from "@nestjs/common";
import { PostModel } from "./post.model";
import { InjectModel } from "~/transformers/model.transformer";
import { AggregatePaginateModel, Document, PipelineStage } from "mongoose";
import { CategoryService } from "../category/category.service";
import slugify from "slugify";
import { isDefined } from "class-validator";
import { omit } from "lodash";
import { BusinessException } from "~/common/exceptions/business.excpetion";
import { ErrorCodeEnum } from "~/constants/error-code.constant";
import { CommentModel, CommentType } from "../comments/comments.model";
import { ImageService } from "~/processors/helper/helper.image.service";
import { PagerDto } from "~/shared/dto/pager.dto";
import { addYearCondition } from "~/transformers/db-query.transformer";

@Injectable()
export class PostService {
  constructor(
    @InjectModel(PostModel)
    private readonly postModel: MongooseModel<PostModel> &
      AggregatePaginateModel<PostModel & Document>,
    @InjectModel(CommentModel)
    private readonly commentModel: MongooseModel<CommentModel>,
    @Inject(forwardRef(() => CategoryService))
    private readonly categoryService: CategoryService,
    private readonly imageService: ImageService,
  ) {}
  get model() {
    return this.postModel;
  }

  async aggregatePaginate(query: PagerDto, isMaster = false) {
    const { size, select, page, year, sortBy, sortOrder } = query;
    return this.model.aggregatePaginate(
      this.model.aggregate(
        [
          {
            $match: {
              ...addYearCondition(year),
            },
          },
          // @see https://stackoverflow.com/questions/54810712/mongodb-sort-by-field-a-if-field-b-null-otherwise-sort-by-field-c
          {
            $addFields: {
              sortField: {
                // create a new field called "sortField"
                $cond: {
                  // and assign a value that depends on
                  if: { $ne: ["$pin", null] }, // whether "b" is not null
                  then: "$pinOrder", // in which case our field shall hold the value of "a"
                  else: "$$REMOVE",
                },
              },
            },
          },
          // if not master, only show published posts
          !isMaster && {
            $match: {
              // match the condition
              hide: { $ne: true }, // $ne: not equal
            },
          },
          // 如果不是master，并且password不为空，则将text,summary修改
          !isMaster && {
            $set: {
              // set the field to a new value
              summary: {
                $cond: {
                  if: { $ne: ["$password", null] }, // if "password" is not null
                  then: { $concat: ["内容已被隐藏，请输入密码"] }, // then the value of "内容已被隐藏"
                  else: "$title", // otherwise, use the original title
                }, // $concat: 用于拼接字符串
              },
              text: {
                $cond: {
                  // 如果密码字段不为空，且isMaster为false，则不显示
                  if: {
                    $ne: ["$password", null],
                  }, // whether "b" is not null
                  then: { $concat: ["内容已被隐藏，请输入密码"] },
                  else: "$text",
                },
              },
            },
          },
          !isMaster && {
            // if not master, only show usual fields
            $project: {
              hide: 0,
              password: 0,
              rss: 0,
            },
          },
          {
            $sort: sortBy
              ? {
                  [sortBy]: sortOrder as any,
                }
              : {
                  sortField: -1, // sort by our computed field
                  pin: -1,
                  created: -1, // and then by the "created" field
                },
          },
          {
            $project: {
              // project the fields we want to keep
              sortField: 0, // remove "sort" field if needed
            },
          },
          select && {
            $project: {
              ...(select?.split(" ").reduce(
                (acc, cur) => {
                  const field = cur.trim();
                  acc[field] = 1;
                  return acc;
                },
                Object.keys(new PostModel()).map((k) => ({ [k]: 0 }))
              ) as any),
            },
          },
          {
            $lookup: {
              // lookup can be used to join two collections
              from: "categories", // from the "categories" collection
              localField: "categoryId", // using the "categoryId" field
              foreignField: "_id", // from the "categories" collection
              as: "category", // as the "category" field
            },
          },
          {
            $unwind: {
              // unwind 将数组的每个元素解析为单个文档
              path: "$category", // the path to the array
              preserveNullAndEmptyArrays: true, // if set to true, MongoDB will still create a document if the array is empty
            },
          },
        ].filter(Boolean) as PipelineStage[]
      ),
      {
        limit: size,
        page,
      }
    );
  }

  /**
   * 创建新文章
   * @param post 文章
   * @returns Promise<PostModel>
   */
  async create(post: PostModel) {
    const { categoryId } = post;
    const category = await this.categoryService.findCategoryById(
      categoryId as any as string
    );
    if (!category) {
      throw new BadRequestException("分类不存在o(╯□╰)o");
    }

    const slug = post.slug ? slugify(post.slug) : slugify(post.title);
    const isAvailableSlug = await this.isAvailableSlug(slug);
    if (!isAvailableSlug) {
      throw new BusinessException(ErrorCodeEnum.SlugNotAvailable);
    }
    const res = await this.postModel.create({
      ...post,
      slug,
      categoryId: category.id,
      created: new Date(),
      modified: null,
    });
    process.nextTick(async () => {
      // 异步更新缓存
      await Promise.all([
        this.imageService.recordImageMeta(this.model, res._id)
      ]);
    });
    return res;
  }

  /**
   * 更新文章
   * @param id 文章id
   * @param data 文章数据
   * @returns Promise<PostModel>
   */
  async updateById(id: string, data: Partial<PostModel>) {
    const oldDocument = await this.postModel.findById(id).lean();
    if (!oldDocument) {
      throw new BadRequestException("文章不存在o(╯□╰)o");
    }
    const { categoryId } = data;
    if (categoryId && categoryId !== oldDocument.categoryId) {
      const category = await this.categoryService.findCategoryById(
        categoryId as any as string
      );
      if (!category) {
        throw new BadRequestException("分类不存在o(╯□╰)o");
      }
    }
    if ([data.text, data.title, data.slug].some((i) => isDefined(i))) {
      const now = new Date();

      data.modified = now;
    }

    const originDocument = await this.postModel.findById(id);
    if (!originDocument) {
      throw new BadRequestException();
    }
    if (data.slug && data.slug !== originDocument.slug) {
      data.slug = slugify(data.slug);
      // 检查slug是否已存在
      const isAvailableSlug = await this.isAvailableSlug(data.slug);
      if (!isAvailableSlug) {
        throw new BusinessException(ErrorCodeEnum.SlugNotAvailable);
      }
    }
    Object.assign(originDocument, omit(data, PostModel.protectedKeys));
    await originDocument.save();

    process.nextTick(async () => {
      await Promise.all([
        this.imageService.recordImageMeta(this.model, id)
      ]);
    });

    return originDocument.toObject();
  }

  /**
   * 根据id删除文章
   * @param id 文章id
   * @returns void
   **/
  async deletePost(id: string) {
    await Promise.all([
      this.model.deleteOne({ _id: id }),
      this.commentModel.deleteMany({ ref: id, refType: CommentType.Post }),
    ]);
  }

  /**
   * 根据id查询文章
   * @param slug 文章slug
   */
  async getPostBySlug(slug: string) {
    return await this.model.findOne({ slug });
  }

  /**
   * 根据 id 查找文章分类
   * @param id 分类 slug
   */
  async getCategoryBySlug(slug: string) {
    return await this.categoryService.model.findOne({ slug });
  }

  /**
   * 查询slug是否可用
   * @param slug 文章slug
   * @returns Promise<boolean>
   */
  async isAvailableSlug(slug: string) {
    return (await this.postModel.countDocuments({ slug })) === 0;
  }

  async CreateDefaultPost(cateId: string) {
    await this.postModel.countDocuments({}).then(async (count) => {
      if (!count) {
        this.postModel.countDocuments({
          title: "欢迎来到 NEXT",
          slug: "welcome-to-next",
          text: "欢迎来到 NEXT，当你看到这条文章的时候，说明你已经成功的安装并初始化了 NEXT。",
          summary: "欢迎来到 NEXT",
          categoryId: cateId,
        });
      }
    });
  }
}
