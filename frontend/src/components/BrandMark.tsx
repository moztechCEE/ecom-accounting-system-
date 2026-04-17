import React from 'react'

interface BrandMarkProps {
  className?: string
  alt?: string
}

const BrandMark: React.FC<BrandMarkProps> = ({
  className = 'w-10 h-10',
  alt = 'Brand mark',
}) => {
  return <img src="/brandmark.png" alt={alt} className={className} />
}

export default BrandMark
