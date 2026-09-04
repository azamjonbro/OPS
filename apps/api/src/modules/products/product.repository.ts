import { BaseRepository } from '../../core/db/base-repository.js';
import { ProductModel, type ProductDocument } from './product.model.js';

class ProductRepository extends BaseRepository<ProductDocument> {
  constructor() {
    super(ProductModel);
  }

  async skuExists(sku: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { sku: sku.trim().toUpperCase() };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return this.exists(filter);
  }

  async barcodeExists(barcode: string, excludeId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { barcode: barcode.trim() };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    return this.exists(filter);
  }

  /** Bulk read used by the sale service, which needs every line's product at once. */
  async findManyByIds(ids: string[]): Promise<ProductDocument[]> {
    return ProductModel.find({ _id: { $in: ids } })
      .lean<ProductDocument[]>()
      .exec();
  }
}

export const productRepository = new ProductRepository();
