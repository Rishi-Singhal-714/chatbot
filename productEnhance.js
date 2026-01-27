const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');

// Static categories list from your data
const staticCategories = [
  { id: 1869, name: "Men", parent_id: 2131 },
  { id: 1870, name: "Women", parent_id: 2131 },
  { id: 1871, name: "Topwear", parent_id: 2131 },
  { id: 1872, name: "Westernwear", parent_id: 2131 },
  { id: 1873, name: "Kids", parent_id: 2131 },
  { id: 1874, name: "Home", parent_id: null },
  { id: 1876, name: "Boys", parent_id: 2131 },
  { id: 1877, name: "Discover", parent_id: null },
  { id: 1879, name: "Bed & Linen", parent_id: 2073 },
  { id: 1880, name: "Bath", parent_id: 2201 },
  { id: 1883, name: "Fragrances", parent_id: 2105 },
  { id: 1885, name: "Mens Grooming", parent_id: 2105 },
  { id: 1886, name: "Health and Wellness Supplements", parent_id: 2105 },
  { id: 1887, name: "Bottomwear", parent_id: 2131 },
  { id: 1888, name: "Footwear", parent_id: 2131 },
  { id: 1889, name: "Festivewear", parent_id: 2131 },
  { id: 1890, name: "Sportswear", parent_id: 2131 },
  { id: 1891, name: "Innerwear", parent_id: 2131 },
  { id: 1892, name: "Accessories", parent_id: 1877 },
  { id: 1893, name: "Indianwear", parent_id: 2131 },
  { id: 1894, name: "Footwear", parent_id: 2131 },
  { id: 1895, name: "Sleepwear", parent_id: 2131 },
  { id: 1896, name: "Sports & Activewear", parent_id: 2131 },
  { id: 1897, name: "Maternity", parent_id: 2131 },
  { id: 1898, name: "Accessories", parent_id: 1877 },
  { id: 1899, name: "Infants", parent_id: 2131 },
  { id: 1900, name: "Footwear", parent_id: 2131 },
  { id: 1901, name: "Accessories", parent_id: 1877 },
  { id: 1902, name: "Homedecor", parent_id: 2069 },
  { id: 1903, name: "Flooring", parent_id: 2073 },
  { id: 1904, name: "Lighting", parent_id: 2069 },
  { id: 1905, name: "Kitchen & Dining", parent_id: 2201 },
  { id: 1906, name: "Storage", parent_id: 2201 },
  { id: 1907, name: "T Shirts", parent_id: 2131 },
  { id: 1908, name: "Casual Shirts", parent_id: 2131 },
  { id: 1909, name: "Formal Shirts", parent_id: 2131 },
  { id: 1910, name: "Co-ord Sets", parent_id: 2131 },
  { id: 1911, name: "Sweaters", parent_id: 2131 },
  { id: 1912, name: "Jackets", parent_id: 2131 },
  { id: 1913, name: "Blazers", parent_id: 2131 },
  { id: 1914, name: "Suits", parent_id: 2131 },
  { id: 1915, name: "Rain Jackets", parent_id: 2131 },
  { id: 1916, name: "Bottomwear", parent_id: 2131 },
  { id: 1917, name: "Casual Trousers", parent_id: 2131 },
  { id: 1918, name: "Formal Trousers", parent_id: 2131 },
  { id: 1919, name: "Shorts", parent_id: 2131 },
  { id: 1920, name: "Track pants & Joggers", parent_id: 2131 },
  { id: 1921, name: "Briefs & Trunks", parent_id: 2131 },
  { id: 1922, name: "Boxers", parent_id: 2131 },
  { id: 1923, name: "Vests", parent_id: 2131 },
  { id: 1924, name: "Sleep & Loungewear", parent_id: 2131 },
  { id: 1925, name: "Thermals", parent_id: 2131 },
  { id: 1926, name: "Kurta & Kurta Sets", parent_id: 2131 },
  { id: 1927, name: "Sherwanis", parent_id: 2131 },
  { id: 1928, name: "Nehru Jackets", parent_id: 2131 },
  { id: 1929, name: "Dhotis", parent_id: 2131 },
  { id: 1930, name: "Casual Shoes", parent_id: 2131 },
  { id: 1931, name: "Sports Shoes", parent_id: 2131 },
  { id: 1932, name: "Formal Shoes", parent_id: 2131 },
  { id: 1933, name: "Footwear", parent_id: 2131 },
  { id: 1934, name: "Sandals & Floaters", parent_id: 2131 },
  { id: 1935, name: "Flip Flops", parent_id: 2131 },
  { id: 1936, name: "Socks", parent_id: 2131 },
  { id: 1937, name: "Sports Shoes", parent_id: 2131 },
  { id: 1938, name: "Sports Sandals", parent_id: 2131 },
  { id: 1939, name: "Active T Shirts", parent_id: 2131 },
  { id: 1940, name: "Track pants & Shorts", parent_id: 2131 },
  { id: 1941, name: "Tracksuits", parent_id: 2131 },
  { id: 1942, name: "Jackets & Sweatshirts", parent_id: 2131 },
  { id: 1943, name: "Sports Accessories", parent_id: 1877 },
  { id: 1944, name: "Swimwear", parent_id: 2131 },
  { id: 1945, name: "Jewellery & Accessories", parent_id: 2128 },
  { id: 1946, name: "Belts", parent_id: 2128 },
  { id: 1947, name: "Perfumes", parent_id: 1877 },
  { id: 1948, name: "Trimmers", parent_id: 2132 },
  { id: 1949, name: "Deaodrants", parent_id: 2105 },
  { id: 1950, name: "Ties, Cufflinks & Pocket Squares", parent_id: 1877 },
  { id: 1951, name: "Accessory Gift Set", parent_id: 1877 },
  { id: 1952, name: "Caps & Hats", parent_id: 1877 },
  { id: 1953, name: "Mufflers, Scarves & Gloves", parent_id: 1877 },
  { id: 1954, name: "Phone Cases", parent_id: 1877 },
  { id: 1955, name: "Accessories", parent_id: 1877 },
  { id: 1956, name: "Helmets", parent_id: 1877 },
  { id: 1957, name: "Dresses", parent_id: 2131 },
  { id: 1958, name: "Tops", parent_id: 2131 },
  { id: 1959, name: "T Shirts", parent_id: 2131 },
  { id: 1960, name: "Jeans", parent_id: 2131 },
  { id: 1961, name: "Trousers", parent_id: 2131 },
  { id: 1962, name: "Shorts & Skirts", parent_id: 2131 },
  { id: 1963, name: "Co-ords", parent_id: 2131 },
  { id: 1964, name: "Playsuits", parent_id: 2131 },
  { id: 1965, name: "Jumpsuits", parent_id: 2131 },
  { id: 1966, name: "Shrugs", parent_id: 2131 },
  { id: 1967, name: "Sweaters & Sweatshirts", parent_id: 2131 },
  { id: 1968, name: "Jackets & Coats", parent_id: 2131 },
  { id: 1969, name: "Blazers & Waistcoats", parent_id: 2131 },
  { id: 1970, name: "Kurtas & Suits", parent_id: 2131 },
  { id: 1971, name: "Kurtis, Tunics & Tops", parent_id: 2131 },
  { id: 1972, name: "Sarees", parent_id: 2131 },
  { id: 1973, name: "Ethnicwear", parent_id: 2131 },
  { id: 1974, name: "Leggings, Salwars & Chudidaars", parent_id: 2131 },
  { id: 1975, name: "Skirts & Palazzos", parent_id: 2131 },
  { id: 1976, name: "Dress Materials", parent_id: 2131 },
  { id: 1977, name: "Lehenga Cholis", parent_id: 2131 },
  { id: 1978, name: "Dupattas & Shawls", parent_id: 2131 },
  { id: 1979, name: "Jackets", parent_id: 2131 },
  { id: 1980, name: "Flats", parent_id: 2131 },
  { id: 1981, name: "Casual Shoes", parent_id: 2131 },
  { id: 1982, name: "Heels", parent_id: 2131 },
  { id: 1983, name: "Boots", parent_id: 2131 },
  { id: 1984, name: "Sports Shoes & Floaters", parent_id: 2131 },
  { id: 1985, name: "Clothing", parent_id: 2131 },
  { id: 1986, name: "Footwear", parent_id: 2131 },
  { id: 1987, name: "Sports Accessories", parent_id: 1877 },
  { id: 1988, name: "Sports Equipment", parent_id: 1877 },
  { id: 1989, name: "Bra", parent_id: 2131 },
  { id: 1990, name: "Briefs", parent_id: 2131 },
  { id: 1991, name: "Shapewear", parent_id: 2131 },
  { id: 1992, name: "Sleepwear & Loungewear", parent_id: 2131 },
  { id: 1993, name: "Swimwear", parent_id: 2131 },
  { id: 1994, name: "Thermals", parent_id: 2131 },
  { id: 1995, name: "Belts, Scarves & More", parent_id: 1877 },
  { id: 1996, name: "Handbags", parent_id: 1877 },
  { id: 1997, name: "Bags & Wallets", parent_id: 1877 },
  { id: 1998, name: "T Shirts", parent_id: 2131 },
  { id: 1999, name: "Shirts", parent_id: 2131 },
  { id: 2000, name: "Shorts", parent_id: 2131 },
  { id: 2001, name: "Jeans", parent_id: 2131 },
  { id: 2002, name: "Trousers", parent_id: 2131 },
  { id: 2003, name: "Clothing Sets", parent_id: 2131 },
  { id: 2004, name: "Ethnicwear", parent_id: 2131 },
  { id: 2005, name: "Track pants & Payjamas", parent_id: 2131 },
  { id: 2006, name: "Jackets, Sweaters & Sweatshirts", parent_id: 2131 },
  { id: 2007, name: "Partywear", parent_id: 2131 },
  { id: 2008, name: "Innerwear & Thermals", parent_id: 2131 },
  { id: 2009, name: "Nightwear & Loungewear", parent_id: 2131 },
  { id: 2010, name: "Value Packs", parent_id: 2131 },
  { id: 2011, name: "Dresses", parent_id: 2131 },
  { id: 2012, name: "Tops", parent_id: 2131 },
  { id: 2013, name: "T Shirts", parent_id: 2131 },
  { id: 2014, name: "Clothing Sets", parent_id: 2131 },
  { id: 2015, name: "Lehenga Choli", parent_id: 2131 },
  { id: 2016, name: "Kurta Sets", parent_id: 2131 },
  { id: 2017, name: "Party Wear", parent_id: 2131 },
  { id: 2018, name: "Dungarees & Jumpsuits", parent_id: 2131 },
  { id: 2019, name: "Skirts & Shorts", parent_id: 2131 },
  { id: 2020, name: "Tights & Leggings", parent_id: 2131 },
  { id: 2021, name: "Jeans, Trousers & Capris", parent_id: 2131 },
  { id: 2022, name: "Jacket, Sweater & Sweatshirts", parent_id: 2131 },
  { id: 2023, name: "Innerwear & Thermals", parent_id: 2131 },
  { id: 2024, name: "Nightwear & Loungewear", parent_id: 2131 },
  { id: 2025, name: "Back to school", parent_id: 2128 },
  { id: 2026, name: "Bodysuits", parent_id: 2131 },
  { id: 2027, name: "Rompers & Sleepsuits", parent_id: 2131 },
  { id: 2028, name: "Clothing Sets", parent_id: 2131 },
  { id: 2029, name: "T shirts & tops", parent_id: 2131 },
  { id: 2030, name: "Dresses", parent_id: 2131 },
  { id: 2031, name: "Bottomwear", parent_id: 2131 },
  { id: 2032, name: "Winterwear", parent_id: 2131 },
  { id: 2033, name: "Innerwear & Sleepwear", parent_id: 2131 },
  { id: 2034, name: "Infant Care", parent_id: 2131 },
  { id: 2035, name: "Casual Shoes", parent_id: 2131 },
  { id: 2036, name: "Flipflops", parent_id: 2131 },
  { id: 2037, name: "Sports Shoes", parent_id: 2131 },
  { id: 2038, name: "Flats", parent_id: 2131 },
  { id: 2039, name: "Sandals", parent_id: 2131 },
  { id: 2040, name: "Heels", parent_id: 2131 },
  { id: 2041, name: "School Shoes", parent_id: 2131 },
  { id: 2042, name: "Socks", parent_id: 2131 },
  { id: 2043, name: "Bags & Backpacks", parent_id: 1877 },
  { id: 2044, name: "Watches", parent_id: 1877 },
  { id: 2045, name: "Jewellery & Hair Accessories", parent_id: 1877 },
  { id: 2046, name: "Sunglasses", parent_id: 2128 },
  { id: 2047, name: "Masks & Protective Gears", parent_id: 2128 },
  { id: 2048, name: "Caps & Hats", parent_id: 2128 },
  { id: 2049, name: "Home", parent_id: 1877 },
  { id: 2050, name: "Bed Runners", parent_id: 2073 },
  { id: 2051, name: "Bedsheets", parent_id: 2073 },
  { id: 2052, name: "Mattress Protectors", parent_id: 2073 },
  { id: 2053, name: "Bedding Sets", parent_id: 2073 },
  { id: 2054, name: "Blankets, Quilts & Dohars", parent_id: 2073 },
  { id: 2055, name: "Pillows & Pillow Covers", parent_id: 2073 },
  { id: 2056, name: "Bed Covers", parent_id: 2073 },
  { id: 2057, name: "Diwan Sets", parent_id: 2073 },
  { id: 2058, name: "Chair Pads & Covers", parent_id: 2073 },
  { id: 2059, name: "Sofa Covers", parent_id: 2073 },
  { id: 2060, name: "Bath Towels", parent_id: 2073 },
  { id: 2061, name: "Hand & Face Towels", parent_id: 2073 },
  { id: 2062, name: "Beach Towels", parent_id: 2073 },
  { id: 2063, name: "Towels Sets", parent_id: 2073 },
  { id: 2064, name: "Bath rugs", parent_id: 2073 },
  { id: 2065, name: "Bath Robes", parent_id: 2073 },
  { id: 2066, name: "Bathroom Accessories", parent_id: 2201 },
  { id: 2067, name: "Shower Curtains", parent_id: 2073 },
  { id: 2068, name: "Floor Runners", parent_id: 2073 },
  { id: 2069, name: "Decor", parent_id: null },
  { id: 2070, name: "Furniture", parent_id: null },
  { id: 2071, name: "Crockery", parent_id: 2201 },
  { id: 2072, name: "Lights", parent_id: 2069 },
  { id: 2073, name: "Handloom", parent_id: null },
  { id: 2074, name: "Table Lamps", parent_id: 2069 },
  { id: 2075, name: "Wall Lamps", parent_id: 2069 },
  { id: 2076, name: "Outdoor Lamps", parent_id: 2069 },
  { id: 2077, name: "String Lights", parent_id: 2069 },
  { id: 2078, name: "Plants & Planters", parent_id: 2070 },
  { id: 2079, name: "Aromas & Candles", parent_id: 2069 },
  { id: 2080, name: "Clocks", parent_id: 2069 },
  { id: 2081, name: "Mirrors", parent_id: 2070 },
  { id: 2082, name: "Wall Decor", parent_id: 2069 },
  { id: 2083, name: "Festive Decor", parent_id: 2069 },
  { id: 2084, name: "Pooja Essentials", parent_id: 2201 },
  { id: 2085, name: "Shelves", parent_id: 2070 },
  { id: 2086, name: "Fountains", parent_id: 2070 },
  { id: 2087, name: "Showpieces & Vases", parent_id: 2069 },
  { id: 2088, name: "Ottoman", parent_id: 2070 },
  { id: 2089, name: "Table Runners", parent_id: 2073 },
  { id: 2090, name: "Dinnerware & Serveware", parent_id: 2201 },
  { id: 2091, name: "Cups & Mugs", parent_id: 2201 },
  { id: 2092, name: "Bakeware & Cookware", parent_id: 2201 },
  { id: 2093, name: "Kitchen Storage & Tools", parent_id: 2201 },
  { id: 2094, name: "Bar & Drinkware", parent_id: 2201 },
  { id: 2095, name: "Table Covers & Furnishings", parent_id: 2073 },
  { id: 2096, name: "Bins", parent_id: 2201 },
  { id: 2097, name: "Hangers", parent_id: 2201 },
  { id: 2098, name: "Organisers", parent_id: 2201 },
  { id: 2099, name: "Hooks & Holders", parent_id: 2201 },
  { id: 2100, name: "Laundry Bags", parent_id: 2201 },
  { id: 2101, name: "Test image", parent_id: null },
  { id: 2102, name: "Laptops", parent_id: 2132 },
  { id: 2103, name: "Eyewear", parent_id: 1877 },
  { id: 2104, name: "Flowers", parent_id: 2069 },
  { id: 2105, name: "Wellness", parent_id: null },
  { id: 2106, name: "Skincare", parent_id: 2105 },
  { id: 2107, name: "Cosmetics & Makeup", parent_id: 2105 },
  { id: 2108, name: "Personal Care & Hygiene", parent_id: 2105 },
  { id: 2109, name: "Cleansers", parent_id: 2105 },
  { id: 2110, name: "Sunscreens", parent_id: 2105 },
  { id: 2111, name: "Toners", parent_id: 2105 },
  { id: 2112, name: "Serums", parent_id: 2105 },
  { id: 2113, name: "Moisturizers", parent_id: 2105 },
  { id: 2114, name: "Body Care", parent_id: 2105 },
  { id: 2115, name: "Face Makeup", parent_id: 2105 },
  { id: 2116, name: "Hair Care", parent_id: 2105 },
  { id: 2117, name: "Lip Makeup", parent_id: 2105 },
  { id: 2118, name: "Makeup Tools & Accessories", parent_id: 2105 },
  { id: 2119, name: "Metals", parent_id: null },
  { id: 2120, name: "Gold", parent_id: 2140 },
  { id: 2121, name: "Silver", parent_id: 2140 },
  { id: 2122, name: "Gold Coin", parent_id: 2140 },
  { id: 2123, name: "Gold Bar", parent_id: 2119 },
  { id: 2124, name: "Silver Coin", parent_id: 2140 },
  { id: 2125, name: "Silver Bar", parent_id: 2140 },
  { id: 2126, name: "Platinum", parent_id: 2140 },
  { id: 2127, name: "Stationary", parent_id: 2128 },
  { id: 2128, name: "Kids Corner", parent_id: null },
  { id: 2129, name: "Gift Items", parent_id: 2128 },
  { id: 2130, name: "Food", parent_id: null },
  { id: 2131, name: "Fashion", parent_id: null },
  { id: 2132, name: "Electronics", parent_id: null },
  { id: 2133, name: "Mobile", parent_id: 2132 },
  { id: 2134, name: "Cameras", parent_id: 2132 },
  { id: 2135, name: "Gadgets", parent_id: 2132 },
  { id: 2136, name: "Discover", parent_id: null },
  { id: 2137, name: "Munchies", parent_id: 2130 },
  { id: 2138, name: "Electronics", parent_id: null },
  { id: 2139, name: "Collectibles", parent_id: 2140 },
  { id: 2140, name: "Jewellery", parent_id: null },
  { id: 2141, name: "Appliances", parent_id: 2132 },
  { id: 2155, name: "Wooden Swing", parent_id: 2070 },
  { id: 2156, name: "Patio Swings", parent_id: 2070 },
  { id: 2157, name: "Kids Swings", parent_id: 2070 },
  { id: 2158, name: "Ottomans", parent_id: 2070 },
  { id: 2159, name: "Chairs & Ottoman", parent_id: 2070 },
  { id: 2160, name: "Benches", parent_id: 2070 },
  { id: 2161, name: "Buddha Fountains", parent_id: 2070 },
  { id: 2162, name: "Religious Fountains", parent_id: 2070 },
  { id: 2163, name: "Decor Fountains", parent_id: 2070 },
  { id: 2164, name: "Tall Vases", parent_id: 2069 },
  { id: 2165, name: "Table Vases", parent_id: 2069 },
  { id: 2166, name: "Flowerpots", parent_id: 2069 },
  { id: 2167, name: "Religious Figurines", parent_id: 2069 },
  { id: 2168, name: "Art Figurines", parent_id: 2069 },
  { id: 2169, name: "Showpieces", parent_id: 2069 },
  { id: 2170, name: "Wall Clocks", parent_id: 2069 },
  { id: 2171, name: "Table Clocks", parent_id: 2069 },
  { id: 2172, name: "Rugs & Carpets", parent_id: 2073 },
  { id: 2173, name: "Runners", parent_id: 2073 },
  { id: 2174, name: "Foot Mats", parent_id: 2073 },
  { id: 2176, name: "Comforters", parent_id: 2073 },
  { id: 2177, name: "Blankets", parent_id: 2073 },
  { id: 2178, name: "Rajaai", parent_id: 2073 },
  { id: 2179, name: "Dohar", parent_id: 2073 },
  { id: 2180, name: "Paintings", parent_id: 2069 },
  { id: 2181, name: "Large Paintings", parent_id: 2069 },
  { id: 2182, name: "Medium Paintings", parent_id: 2069 },
  { id: 2183, name: "Small Paintings", parent_id: 2069 },
  { id: 2184, name: "Patio Furniture", parent_id: 2070 },
  { id: 2185, name: "Patio Sets", parent_id: 2070 },
  { id: 2186, name: "Wooden Sets", parent_id: 2070 },
  { id: 2187, name: "Cain Furniture", parent_id: 2070 },
  { id: 2188, name: "Side Tables", parent_id: 2070 },
  { id: 2189, name: "Coffee Tables", parent_id: 2070 },
  { id: 2190, name: "Bar Furniture", parent_id: 2070 },
  { id: 2191, name: "Organizers", parent_id: 2201 },
  { id: 2192, name: "Laundry Basket", parent_id: 2201 },
  { id: 2193, name: "Closet Basket", parent_id: 2201 },
  { id: 2194, name: "Kitchen Basket", parent_id: 2201 },
  { id: 2195, name: "Serving Trays", parent_id: 2201 },
  { id: 2196, name: "Bar Items", parent_id: 2201 },
  { id: 2197, name: "Crockery Sets", parent_id: 2201 },
  { id: 2198, name: "Platter Sets", parent_id: 2201 },
  { id: 2199, name: "Glassware", parent_id: 2201 },
  { id: 2201, name: "Kitchen", parent_id: null },
  { id: 2202, name: "Toys & Stationary", parent_id: 2128 },
  { id: 2204, name: "Swings", parent_id: 2070 },
  { id: 2207, name: "Vases", parent_id: 2069 },
  { id: 2208, name: "Patio Furniture", parent_id: 2070 },
  { id: 2209, name: "Tables & Consoles", parent_id: 2070 },
  { id: 2211, name: "Beddings", parent_id: 2073 },
  { id: 2212, name: "Mats & Cushions", parent_id: 2073 },
  { id: 2213, name: "Outdoor", parent_id: 2070 },
  { id: 2214, name: "Seating", parent_id: 2070 },
  { id: 2215, name: "Unisex", parent_id: 1877 },
  { id: 2216, name: "Towels", parent_id: 2073 },
  { id: 2217, name: "Covers", parent_id: 2073 },
  { id: 2218, name: "Curtains", parent_id: 2073 }
];

// Check if image is already on zulushop
function isZulushopImage(url) {
  return url && url.includes('zulushop.in');
}

// Upload image to hostinger (only if not already on zulushop)
async function uploadImageToHostinger(imageData, fileName) {
  try {
    // Create FormData
    const formData = new FormData();
    
    if (typeof imageData === 'string' && imageData.startsWith('data:image')) {
      // Base64 image
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      formData.append('image', buffer, {
        filename: fileName || `product_${Date.now()}.jpg`,
        contentType: 'image/jpeg'
      });
    } else if (typeof imageData === 'object' && imageData.buffer) {
      // Buffer
      formData.append('image', imageData.buffer, {
        filename: fileName || `product_${Date.now()}.jpg`,
        contentType: 'image/jpeg'
      });
    }
    
    // Upload to hostinger
    const response = await axios.post('https://api.zulushop.in/api/v1/user/upload', formData, {
      headers: {
        ...formData.getHeaders(),
      },
      timeout: 30000 // 30 seconds
    });
    
    // Extract URL from response
    if (response.data.url) {
      return response.data.url;
    } else if (response.data.image_url) {
      return response.data.image_url;
    } else if (response.data.data?.url) {
      return response.data.data.url;
    } else if (response.data.data?.image_url) {
      return response.data.image_url;
    }
    
    throw new Error('No image URL in response');
    
  } catch (error) {
    console.error('Upload to hostinger failed:', error.message);
    return null;
  }
}

// Process image URL - only upload if not from zulushop
async function processImage(imageInput, productName) {
  try {
    let originalImageUrl = imageInput;
    let enhancedImageUrl = imageInput;
    
    console.log('🖼️ Processing image...');
    
    // Check if it's already a zulushop image
    if (isZulushopImage(imageInput)) {
      console.log('✅ Image is already on zulushop, skipping upload');
    } else if (imageInput.startsWith('data:image')) {
      // Base64 image - always upload
      console.log('📤 Uploading base64 image to hostinger...');
      const fileName = `${productName.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
      originalImageUrl = await uploadImageToHostinger(imageInput, fileName);
    } else if (imageInput.startsWith('http')) {
      // External URL - download and upload
      console.log('🌐 Downloading external image...');
      try {
        const response = await axios.get(imageInput, { 
          responseType: 'arraybuffer',
          timeout: 15000 
        });
        
        console.log('📤 Uploading external image to hostinger...');
        const fileName = `external_${productName.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
        originalImageUrl = await uploadImageToHostinger(
          { buffer: Buffer.from(response.data) }, 
          fileName
        );
      } catch (downloadError) {
        console.error('Failed to download external image:', downloadError.message);
      }
    }
    
    // If upload failed, use original input
    if (!originalImageUrl) {
      originalImageUrl = imageInput;
    }
    
    // Step 2: Try to enhance image using existing API
    console.log('🤖 Trying to enhance image...');
    try {
      const enhanceResponse = await fetch('https://chatbot-umber-gamma.vercel.app/api/ai/enhance-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageUrl: originalImageUrl,
          productName: productName
        })
      });
      
      const enhanceResult = await enhanceResponse.json();
      
      if (enhanceResult.success && enhanceResult.enhancedImageUrl) {
        enhancedImageUrl = enhanceResult.enhancedImageUrl;
        console.log('✅ Image enhanced successfully');
        
        // Upload enhanced image if it's not from zulushop
        if (!isZulushopImage(enhancedImageUrl)) {
          console.log('📤 Uploading enhanced image...');
          try {
            const enhancedResponse = await axios.get(enhancedImageUrl, { 
              responseType: 'arraybuffer',
              timeout: 15000 
            });
            
            const fileName = `enhanced_${productName.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
            const uploadedEnhancedUrl = await uploadImageToHostinger(
              { buffer: Buffer.from(enhancedResponse.data) }, 
              fileName
            );
            
            if (uploadedEnhancedUrl) {
              enhancedImageUrl = uploadedEnhancedUrl;
            }
          } catch (uploadError) {
            console.error('Failed to upload enhanced image:', uploadError.message);
          }
        }
      }
    } catch (enhanceError) {
      console.warn('Image enhancement failed:', enhanceError.message);
      // Use original image as enhanced
      enhancedImageUrl = originalImageUrl;
    }
    
    return {
      originalImageUrl,
      enhancedImageUrl,
      wasEnhanced: enhancedImageUrl !== originalImageUrl
    };
    
  } catch (error) {
    console.error('Image processing error:', error);
    return {
      originalImageUrl: imageInput,
      enhancedImageUrl: imageInput,
      wasEnhanced: false
    };
  }
}

// Get parent category name
function getParentName(parentId) {
  if (!parentId) return 'Main Category';
  const parent = staticCategories.find(cat => cat.id === parentId);
  return parent ? parent.name : 'Unknown';
}

// Analyze categories using ChatGPT with static list
async function analyzeCategoriesWithChatGPT(productName, imageUrl, description = '') {
  console.log('🤖 Asking ChatGPT to analyze categories...');
  
  try {
    // Add delay of 5 seconds
    console.log('⏳ Waiting 5 seconds before category analysis...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Prepare category options string
    const categoryOptions = staticCategories.map(cat => {
      if (cat.parent_id) {
        return `${cat.id}: ${cat.name} (Sub-category of ${getParentName(cat.parent_id)})`;
      }
      return `${cat.id}: ${cat.name} (Main Category)`;
    }).join('\n');
    
    const prompt = `
    Analyze this product and suggest the best category and sub-category (cat1) from the available options.
    
    PRODUCT DETAILS:
    - Name: ${productName}
    - Description: ${description || 'No description'}
    
    AVAILABLE CATEGORIES:
    ${categoryOptions}
    
    INSTRUCTIONS:
    1. Look at the product name and description to understand what it is
    2. Suggest the most appropriate main category (where parent_id is null)
    3. For cat1 (sub-category), suggest the most specific relevant category that is a sub-category of the main category
    4. Only suggest categories that exist in the available list
    5. If suggesting a change, explain why
    6. Return in valid JSON format only
    
    IMPORTANT:
    - cat1 MUST be a sub-category of the main category (check parent_id)
    - If no perfect match exists, choose the closest general category
    - Do NOT invent new category names
    
    RETURN JSON FORMAT:
    {
        "suggestedCategory": {"id": 123, "name": "Category Name"},
        "suggestedCat1": {"id": 456, "name": "Cat1 Name"},
        "analysis": "Brief explanation of why these categories were chosen"
    }
    `;
    
    // Call your existing analyze-categories endpoint
    const response = await fetch('https://chatbot-umber-gamma.vercel.app/api/ai/analyze-categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productName: productName,
        currentCategory: '',
        currentCat1: '',
        imageUrl: imageUrl,
        description: description
      })
    });
    
    if (!response.ok) {
      throw new Error(`Category API returned ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      // Validate the suggested categories exist in our static list
      if (result.suggestedCategory) {
        const foundCat = staticCategories.find(cat => 
          cat.id == result.suggestedCategory.id || 
          cat.name.toLowerCase() === result.suggestedCategory.name.toLowerCase()
        );
        
        if (!foundCat) {
          console.warn('Suggested category not found in static list:', result.suggestedCategory);
          // Find closest match
          const mainCategories = staticCategories.filter(cat => !cat.parent_id);
          result.suggestedCategory = { 
            id: mainCategories[0]?.id || 1874, 
            name: mainCategories[0]?.name || "Home" 
          };
          result.analysis = "Category not found in list, using default category";
        }
      }
      
      if (result.suggestedCat1) {
        const foundCat1 = staticCategories.find(cat => 
          cat.id == result.suggestedCat1.id || 
          cat.name.toLowerCase() === result.suggestedCat1.name.toLowerCase()
        );
        
        if (!foundCat1) {
          console.warn('Suggested cat1 not found in static list:', result.suggestedCat1);
          result.suggestedCat1 = null;
        }
      }
      
      return result;
    }
    
    throw new Error('Category analysis failed');
    
  } catch (error) {
    console.error('ChatGPT category analysis failed:', error.message);
    
    // Fallback: Find a relevant category
    const name = productName.toLowerCase();
    
    // Try to find a match
    for (const cat of staticCategories) {
      if (name.includes(cat.name.toLowerCase()) || cat.name.toLowerCase().includes(name.split(' ')[0])) {
        const mainCategories = staticCategories.filter(c => !c.parent_id);
        return {
          success: true,
          suggestedCategory: { id: mainCategories[0]?.id || 1874, name: mainCategories[0]?.name || "Home" },
          suggestedCat1: cat.parent_id ? { id: cat.id, name: cat.name } : null,
          analysis: `Matched category based on keyword: ${cat.name}`
        };
      }
    }
    
    // Default fallback
    const mainCategories = staticCategories.filter(cat => !cat.parent_id);
    return {
      success: true,
      suggestedCategory: { id: mainCategories[0]?.id || 1874, name: mainCategories[0]?.name || "Home" },
      suggestedCat1: null,
      analysis: "Using default category after analysis failure"
    };
  }
}

// Generate basic tags
function generateBasicTags(productName, category) {
  const tags = [];
  
  // Add words from product name
  const words = productName.toLowerCase()
    .split(' ')
    .filter(word => word.length > 2)
    .slice(0, 5);
  
  tags.push(...words);
  
  // Add category
  if (category) {
    tags.push(category.name.toLowerCase());
  }
  
  // Add some generic tags
  tags.push('new', '2024', 'product', 'best');
  
  // Remove duplicates and return
  return [...new Set(tags)].slice(0, 10);
}

// Generate basic descriptions
function generateBasicDescriptions(productName, category, price) {
  const priceText = price ? ` priced at just ₹${price}` : '';
  
  const mainDescription = `Introducing the ${productName}, a premium ${category?.name || 'product'} that combines quality and style. Perfect for everyday use, this product offers excellent value and reliable performance.${priceText}. Get yours today and experience the difference!`;
  
  const extraDescription = `Premium quality\nGreat value for money\nPerfect for gifting\nTrusted brand`;
  
  return {
    mainDescription,
    extraDescription
  };
}

// MAIN API ENDPOINT
router.post('/api/ai/enhance-product', async (req, res) => {
  try {
    console.log('🚀 AI Product Enhancement Request Received');
    
    const { image, name, price, description } = req.body;
    
    // Validate input
    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Image is required'
      });
    }
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Product name is required'
      });
    }
    
    console.log(`📦 Processing: ${name} | Price: ${price || 'Not specified'}`);
    
    // Step 1: Process image (only upload if needed)
    const imageResult = await processImage(image, name);
    
    // Step 2: Analyze categories with ChatGPT
    console.log('📂 Step 2: Analyzing categories with ChatGPT...');
    const categoryResult = await analyzeCategoriesWithChatGPT(name, imageResult.enhancedImageUrl, description || '');
    
    // Step 3: Generate tags using existing API
    console.log('🏷️ Step 3: Generating tags...');
    let tags;
    
    try {
      const tagsResponse = await fetch('https://chatbot-umber-gamma.vercel.app/api/ai/generate-tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productName: name,
          category: categoryResult.suggestedCategory?.name || 'Home',
          cat1: categoryResult.suggestedCat1?.name || '',
          description: description || '',
          price: price
        }),
        timeout: 10000
      });
      
      if (tagsResponse.ok) {
        const tagsData = await tagsResponse.json();
        if (tagsData.success && tagsData.tags) {
          tags = tagsData.tags;
        }
      }
    } catch (tagsError) {
      console.warn('Tags API failed, using basic tags:', tagsError.message);
    }
    
    // If AI tags failed, use basic tags
    if (!tags) {
      tags = generateBasicTags(name, categoryResult.suggestedCategory);
    }
    
    // Step 4: Generate descriptions using existing API
    console.log('📝 Step 4: Generating descriptions...');
    let descriptions;
    
    try {
      const descResponse = await fetch('https://chatbot-umber-gamma.vercel.app/api/ai/generate-descriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productName: name,
          category: categoryResult.suggestedCategory?.name || 'Home',
          cat1: categoryResult.suggestedCat1?.name || '',
          tags: tags,
          price: price,
          currentDescription: description || ''
        }),
        timeout: 15000
      });
      
      if (descResponse.ok) {
        const descData = await descResponse.json();
        if (descData.success) {
          descriptions = {
            mainDescription: descData.description || '',
            extraDescription: descData.extraDescription || ''
          };
        }
      }
    } catch (descError) {
      console.warn('Descriptions API failed, using basic descriptions:', descError.message);
    }
    
    // If AI descriptions failed, use basic descriptions
    if (!descriptions) {
      descriptions = generateBasicDescriptions(name, categoryResult.suggestedCategory, price);
    }
    
    // Step 5: Prepare final response
    console.log('✨ Step 5: Preparing response...');
    const result = {
      success: true,
      message: 'Product enhanced successfully!',
      data: {
        originalImage: imageResult.originalImageUrl,
        enhancedImage: imageResult.enhancedImageUrl,
        productName: name,
        price: price || 0,
        category: {
          id: categoryResult.suggestedCategory?.id || 1874,
          name: categoryResult.suggestedCategory?.name || "Home"
        },
        cat1: categoryResult.suggestedCat1 ? {
          id: categoryResult.suggestedCat1.id,
          name: categoryResult.suggestedCat1.name
        } : null,
        tags: tags,
        mainDescription: descriptions.mainDescription,
        extraDescription: descriptions.extraDescription,
        analysis: categoryResult.analysis || 'Category analysis completed'
      },
      metadata: {
        processedAt: new Date().toISOString(),
        imageEnhanced: imageResult.wasEnhanced,
        aiGenerated: true,
        hasCategory: !!categoryResult.suggestedCategory,
        hasCat1: !!categoryResult.suggestedCat1,
        tagsCount: tags.length,
        usedStaticCategories: true
      }
    };
    
    console.log('✅ Product enhancement completed successfully!');
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ AI Product Enhancement Error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      data: {
        originalImage: req.body.image,
        enhancedImage: req.body.image,
        productName: req.body.name || 'Product',
        price: req.body.price || 0,
        category: { id: 1874, name: 'Home' },
        cat1: null,
        tags: ['product', 'item'],
        mainDescription: `Introducing ${req.body.name || 'Product'}, a quality product for everyday use.`,
        extraDescription: 'Premium quality | Great value | Trusted brand',
        analysis: 'Error occurred during processing'
      }
    });
  }
});

// Demo HTML page (same as before, just update default values)
router.get('/demo/enhance-product', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Product Enhancement Demo</title>
    <style>
      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        padding: 30px;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      }
      h1 {
        color: #333;
        text-align: center;
        margin-bottom: 30px;
        font-size: 32px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .demo-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 30px;
        margin-bottom: 30px;
      }
      .input-section, .output-section {
        background: #f8f9fa;
        padding: 25px;
        border-radius: 15px;
        border: 2px solid #e9ecef;
        box-shadow: 0 5px 15px rgba(0,0,0,0.05);
      }
      h2 {
        color: #495057;
        margin-top: 0;
        padding-bottom: 15px;
        border-bottom: 3px solid #667eea;
      }
      .form-group {
        margin-bottom: 25px;
      }
      label {
        display: block;
        margin-bottom: 10px;
        font-weight: 600;
        color: #495057;
        font-size: 14px;
      }
      input, textarea {
        width: 100%;
        padding: 12px 15px;
        border: 2px solid #dee2e6;
        border-radius: 10px;
        font-size: 14px;
        transition: all 0.3s;
      }
      input:focus, textarea:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      }
      textarea {
        height: 80px;
        resize: vertical;
      }
      .image-preview {
        width: 100%;
        height: 150px;
        object-fit: contain;
        border: 2px dashed #adb5bd;
        border-radius: 10px;
        margin-top: 10px;
        background: white;
        padding: 10px;
      }
      button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 15px 30px;
        border-radius: 10px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        transition: all 0.3s;
        margin-top: 10px;
      }
      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      .result-item {
        background: white;
        padding: 20px;
        margin-bottom: 20px;
        border-radius: 12px;
        border-left: 5px solid #667eea;
        box-shadow: 0 3px 10px rgba(0,0,0,0.08);
      }
      .result-title {
        font-weight: 700;
        color: #333;
        margin-bottom: 10px;
        font-size: 15px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .image-comparison {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-top: 15px;
      }
      .image-box {
        text-align: center;
      }
      .image-box img {
        max-width: 100%;
        max-height: 200px;
        border-radius: 8px;
        border: 2px solid #e9ecef;
      }
      .image-label {
        margin-top: 8px;
        font-size: 12px;
        color: #6c757d;
        font-weight: 600;
      }
      .tag-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }
      .tag {
        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
        color: #1565c0;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
      }
      .description-box {
        background: #f8f9fa;
        padding: 15px;
        border-radius: 8px;
        margin-top: 10px;
        border-left: 4px solid #4CAF50;
        line-height: 1.6;
      }
      .extra-description-box {
        background: #fff3e0;
        padding: 15px;
        border-radius: 8px;
        margin-top: 10px;
        border-left: 4px solid #ff9800;
        font-style: italic;
        color: #e65100;
        white-space: pre-line;
        line-height: 1.6;
      }
      .loading {
        text-align: center;
        padding: 40px;
        display: none;
      }
      .loading.active {
        display: block;
      }
      .spinner {
        border: 5px solid #f3f3f3;
        border-top: 5px solid #667eea;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .api-info {
        background: #2d3748;
        color: white;
        padding: 20px;
        border-radius: 10px;
        margin-top: 30px;
        overflow-x: auto;
      }
      pre {
        margin: 0;
        font-family: 'Courier New', monospace;
        font-size: 13px;
      }
      .status-indicator {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        margin-left: 10px;
      }
      .status-indicator.success {
        background: #d4edda;
        color: #155724;
      }
      .status-indicator.error {
        background: #f8d7da;
        color: #721c24;
      }
      .note-box {
        margin-top: 20px;
        padding: 15px;
        background: #e8f5e9;
        border-radius: 8px;
        font-size: 13px;
      }
      @media (max-width: 768px) {
        .demo-grid {
          grid-template-columns: 1fr;
        }
        .image-comparison {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>🚀 AI Product Enhancement Demo</h1>
      
      <div class="demo-grid">
        <div class="input-section">
          <h2>📤 Input Product Details</h2>
          
          <div class="form-group">
            <label>Product Name:</label>
            <input type="text" id="productName" placeholder="Enter product name" 
                   value="Table Lamp with Wooden Base">
          </div>
          
          <div class="form-group">
            <label>Price (₹):</label>
            <input type="number" id="productPrice" placeholder="Enter price" 
                   value="1299">
          </div>
          
          <div class="form-group">
            <label>Description (Optional):</label>
            <textarea id="productDescription" placeholder="Enter product description"></textarea>
          </div>
          
          <div class="form-group">
            <label>Image URL:</label>
            <input type="text" id="imageUrl" placeholder="Enter image URL" 
                   value="https://zulushop.in/uploads/media/2025/enhanced_28670_1769250232817_1769250233337_dr1pad.jpg">
            <div style="margin-top: 10px; text-align: center;">
              <img id="urlPreview" class="image-preview" src="" alt="Image Preview">
              <div style="font-size: 12px; color: #6c757d; margin-top: 5px;">
                Live Preview
              </div>
            </div>
          </div>
          
          <div class="form-group">
            <label>OR Upload Image:</label>
            <input type="file" id="imageUpload" accept="image/*" style="display: none;">
            <button type="button" onclick="document.getElementById('imageUpload').click()" 
                    style="background: #6c757d; margin-bottom: 10px;">
              📁 Choose Image File
            </button>
            <div style="text-align: center;">
              <img id="uploadPreview" class="image-preview" src="" alt="Upload Preview">
              <div style="font-size: 12px; color: #6c757d; margin-top: 5px;">
                Uploaded Image Preview
              </div>
            </div>
          </div>
          
          <button id="enhanceBtn" onclick="enhanceProduct()">
            ✨ Enhance Product with AI
          </button>
          
          <div class="note-box">
            <strong>ℹ️ Note:</strong> 
            <ul style="margin: 10px 0 0 20px;">
              <li>Uses ChatGPT for category analysis with 5-second delay</li>
              <li>Uses static categories list (${staticCategories.length} categories)</li>
              <li>Images on zulushop.in won't be re-uploaded</li>
              <li>External images auto-uploaded to CDN</li>
            </ul>
          </div>
        </div>
        
        <div class="output-section">
          <h2>📥 AI Generated Results</h2>
          <div id="resultsContainer">
            <div style="text-align: center; padding: 60px 20px; color: #6c757d;">
              <div style="font-size: 48px; margin-bottom: 20px;">📦</div>
              <h3 style="margin: 0 0 10px 0; color: #495057;">No Results Yet</h3>
              <p>Fill in product details and click "Enhance Product with AI"</p>
            </div>
          </div>
        </div>
      </div>
      
      <div id="loading" class="loading">
        <div class="spinner"></div>
        <h3>🤖 AI is Enhancing Your Product...</h3>
        <p id="loadingStatus">Processing image, analyzing categories (5s delay), generating content...</p>
        <div style="margin-top: 20px; font-size: 14px; color: #6c757d;">
          This may take 30-60 seconds. Please wait...
        </div>
      </div>
      
      <div class="api-info">
        <h3 style="color: white; margin-top: 0;">📋 API Usage</h3>
        <pre>
POST /api/ai/enhance-product
Content-Type: application/json

{
  "image": "https://zulushop.in/uploads/media/2025/enhanced_28670_1769250232817_1769250233337_dr1pad.jpg",
  "name": "Table Lamp with Wooden Base",
  "price": 1299,
  "description": "Beautiful wooden table lamp for home decor"
}

Response includes:
- Enhanced image URL
- Category & Cat1 from static list
- 10 SEO tags
- Main & Extra descriptions
- ChatGPT analysis
        </pre>
      </div>
    </div>
    
    <script>
      let uploadedImageBase64 = null;
      
      // Preview image from URL
      document.getElementById('imageUrl').addEventListener('input', function(e) {
        const preview = document.getElementById('urlPreview');
        if (e.target.value) {
          preview.src = e.target.value;
          preview.onerror = function() {
            this.src = 'https://via.placeholder.com/300x200?text=Invalid+Image+URL';
          };
        } else {
          preview.src = '';
        }
      });
      
      // Handle file upload
      document.getElementById('imageUpload').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          // Validate file type
          if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
          }
          
          // Validate file size (5MB max)
          if (file.size > 5 * 1024 * 1024) {
            alert('Image size must be less than 5MB');
            return;
          }
          
          const reader = new FileReader();
          reader.onload = function(event) {
            uploadedImageBase64 = event.target.result;
            document.getElementById('uploadPreview').src = uploadedImageBase64;
          };
          reader.readAsDataURL(file);
        }
      });
      
      // Initialize URL preview
      document.getElementById('urlPreview').src = document.getElementById('imageUrl').value;
      
      async function enhanceProduct() {
        const name = document.getElementById('productName').value.trim();
        const price = document.getElementById('productPrice').value;
        const description = document.getElementById('productDescription').value.trim();
        let image = document.getElementById('imageUrl').value.trim();
        
        if (!name) {
          alert('Please enter product name');
          return;
        }
        
        // Use uploaded image if available
        if (uploadedImageBase64) {
          image = uploadedImageBase64;
        }
        
        if (!image) {
          alert('Please provide an image URL or upload an image');
          return;
        }
        
        // Show loading
        document.getElementById('loading').classList.add('active');
        document.getElementById('enhanceBtn').disabled = true;
        document.getElementById('enhanceBtn').innerHTML = '⏳ Processing...';
        
        try {
          console.log('🚀 Sending request to AI enhancement API...');
          
          const response = await fetch('/api/ai/enhance-product', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              image: image,
              name: name,
              price: parseFloat(price) || 0,
              description: description
            })
          });
          
          const result = await response.json();
          
          console.log('✅ API Response:', result);
          
          if (result.success) {
            displayResults(result.data);
          } else {
            alert('❌ Error: ' + (result.error || 'Unknown error'));
          }
          
        } catch (error) {
          console.error('❌ Network error:', error);
          alert('Network error: ' + error.message);
        } finally {
          document.getElementById('loading').classList.remove('active');
          document.getElementById('enhanceBtn').disabled = false;
          document.getElementById('enhanceBtn').innerHTML = '✨ Enhance Product with AI';
        }
      }
      
      function displayResults(data) {
        const container = document.getElementById('resultsContainer');
        
        const html = \`
          <!-- Image Comparison -->
          <div class="result-item">
            <div class="result-title">🖼️ Image Comparison</div>
            <div class="image-comparison">
              <div class="image-box">
                <img src="\${data.originalImage}" alt="Original Image" 
                     onerror="this.src='https://via.placeholder.com/300x200?text=Image+Error'">
                <div class="image-label">Original Image</div>
              </div>
              <div class="image-box">
                <img src="\${data.enhancedImage}" alt="Enhanced Image" 
                     onerror="this.src='https://via.placeholder.com/300x200?text=Enhanced+Image+Error'">
                <div class="image-label">✨ AI Enhanced Image</div>
              </div>
            </div>
          </div>
          
          <!-- Product Info -->
          <div class="result-item">
            <div class="result-title">📦 Product Information</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div>
                <strong>Product Name:</strong><br>
                <span style="font-size: 16px; font-weight: 600; color: #333;">\${data.productName}</span>
              </div>
              <div>
                <strong>Price:</strong><br>
                <span style="font-size: 18px; font-weight: 700; color: #e74c3c;">₹\${data.price}</span>
              </div>
            </div>
          </div>
          
          <!-- Categories -->
          <div class="result-item">
            <div class="result-title">📂 Categories</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
              <div style="padding: 12px; background: #e8f5e9; border-radius: 8px;">
                <strong>Main Category:</strong><br>
                <span style="font-weight: 600;">\${data.category.name}</span>
                \${data.category.id ? \`<span class="status-indicator success">ID: \${data.category.id}</span>\` : ''}
              </div>
              \${data.cat1 ? \`
              <div style="padding: 12px; background: #e3f2fd; border-radius: 8px;">
                <strong>Sub Category (Cat1):</strong><br>
                <span style="font-weight: 600;">\${data.cat1.name}</span>
                \${data.cat1.id ? \`<span class="status-indicator success">ID: \${data.cat1.id}</span>\` : ''}
              </div>
              \` : \`
              <div style="padding: 12px; background: #fff3e0; border-radius: 8px;">
                <strong>Sub Category (Cat1):</strong><br>
                <span style="color: #e65100; font-style: italic;">No cat1 suggested</span>
              </div>
              \`}
            </div>
            \${data.analysis ? \`
            <div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 13px; color: #6c757d; line-height: 1.5;">
              <strong>Analysis:</strong> \${data.analysis}
            </div>
            \` : ''}
          </div>
          
          <!-- Tags -->
          <div class="result-item">
            <div class="result-title">🏷️ Generated Tags</div>
            <div class="tag-container">
              \${data.tags.map(tag => \`<span class="tag">\${tag}</span>\`).join('')}
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #6c757d;">
              \${data.tags.length} SEO tags generated
            </div>
          </div>
          
          <!-- Main Description -->
          <div class="result-item">
            <div class="result-title">📝 Main Description</div>
            <div class="description-box">
              \${data.mainDescription}
            </div>
          </div>
          
          <!-- Extra Description -->
          <div class="result-item">
            <div class="result-title">✨ Extra Description</div>
            <div class="extra-description-box">
              \${data.extraDescription}
            </div>
          </div>
          
          <!-- Success Message -->
          <div style="margin-top: 30px; padding: 20px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; border-radius: 12px; text-align: center;">
            <h3 style="margin: 0 0 10px 0; color: white;">✅ Enhancement Complete!</h3>
            <p style="margin: 0; opacity: 0.9;">ChatGPT analyzed categories from ${staticCategories.length} options.</p>
          </div>
        \`;
        
        container.innerHTML = html;
      }
    </script>
  </body>
  </html>
  `;
  
  res.send(html);
});

module.exports = router;