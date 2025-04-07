0# The Wyrnlands - Definitions

This document defines key terms and concepts used within The Wyrnlands project.

---

## Businesses

Specialized entities, owned by NPCs or the Player, that perform economic activities like resource extraction, crafting, or services.

-   **Blacksmith:** Crafts metal tools, equipment, and potentially armor/weapons from raw materials (e.g., ore, coal). Requires a workshop building.
-   **Mining Operation:** Extracts raw resources (e.g., stone, ore, coal) from designated map tiles (e.g., quarries, mines). Requires appropriate structures (e.g., mine entrance, quarry shed).
-   **Transportation Service:** Moves goods or people between locations using vehicles/mounts (e.g., carts, wagons). Manages routes, contracts, and potentially drivers.

*(Add definitions for other business types like Farms, Mills, Bakeries, etc., as they are implemented)*

---

## Guilds

Organizations of individuals (NPCs/Player) sharing a common trade or purpose. Guilds may regulate standards, set prices, collect fees, offer benefits, and influence local politics or reputation.

-   **Crafting Guilds:** (e.g., Blacksmiths' Guild, Carpenters' Guild) Focus on specific production trades.
-   **Merchant Guilds:** Focus on trade, logistics, and market control.
-   **Adventurer Guilds:** (Potential future) Focus on quests, exploration, hunting.

*(Add specific guild examples and mechanics as implemented)*

---

## Mounts

Animals used for travel or transport, providing bonuses to speed and/or carrying capacity.

-   **Horse:** Standard riding mount, increases travel speed.
-   **Horse and Cart:** Slower than a riding horse but significantly increases carrying capacity for goods transport.

*(Add other mount types like Donkeys, Oxen as implemented)*

---

## Economy

-   **Currency:** The primary medium of exchange. Stored internally as the smallest unit (Copper Pieces).
    -   100 Copper = 1 Silver
    -   100 Silver = 1 Gold (1 Gold = 10,000 Copper)
-   **Wages:** Payment received by individuals for performing labor, typically influenced by skill, job difficulty, and reputation.
-   **Transactions:** The exchange of currency between entities (Player, NPCs, Businesses, Guilds) for goods or services.

---

## Titles

A system representing social standing and privileges within the game world. Titles are assigned to both Player and NPCs and influence interactions and capabilities.

-   **Commoner:** Base title, representing a regular inhabitant.
-   **Freeman:** Owns land or a small business.
-   **Citizen:** Respected community member, potentially in a guild.
-   **Burgher:** Influential citizen, master craftsman or merchant.
-   **Reeve:** Local official overseeing village matters.
-   **Knight:** Warrior granted land and title.
-   **Baron/Baroness:** Noble holding significant lands.

*(Definitions based on `src/data/titlesData.js`. Add more as implemented.)*

---