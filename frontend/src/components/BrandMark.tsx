import React from 'react'
import { PRODUCT } from '../config/product'

interface BrandMarkProps {
  className?: string
  alt?: string
}

const BrandMark: React.FC<BrandMarkProps> = ({
  className = 'w-10 h-10',
  alt = PRODUCT.brand,
}) => {
  return <img src={PRODUCT.mark} alt={alt} className={className} />
}

export default BrandMark
